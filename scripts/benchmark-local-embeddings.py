#!/usr/bin/env python3
"""Compare the V2 lexical baseline with local static embeddings and RRF fusion.

This is a research-only benchmark. It does not add Python or the embedding model to the
mcp-search-net runtime. The CI research job installs the pinned benchmark dependency in an
ephemeral environment and writes a versionable JSON report.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import resource
import sqlite3
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from huggingface_hub import snapshot_download
from model2vec import StaticModel

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "benchmarks/v2-search-quality/corpus-manifest.json"
QUERIES_PATH = ROOT / "benchmarks/v2-search-quality/queries.json"
MODEL_ID = "minishlab/potion-multilingual-128M"
MODEL_REVISION = "f69cef6ccdb71bedbb8875bfeee1419639c51b2f"
MODEL_LICENSE = "MIT"
MODEL_DIMENSIONS = 256
RESULT_LIMIT = 10
CANDIDATE_LIMIT = 40
RRF_K = 60
MAX_SECTIONS_PER_DOCUMENT = 500
MAX_REPETITIONS = 20
MAX_WARMUP_ROUNDS = 5
SECTION_INDEXES_BY_COUNT = {
    count: range(count) for count in range(1, MAX_SECTIONS_PER_DOCUMENT + 1)
}
ITERATIONS_BY_COUNT = {
    count: range(count) for count in range(MAX_REPETITIONS + 1)
}


def bounded_integer(minimum: int, maximum: int):
    def parse(value: str) -> int:
        parsed = int(value)
        if parsed < minimum or parsed > maximum:
            raise argparse.ArgumentTypeError(
                f"value must be between {minimum} and {maximum}"
            )
        return parsed

    return parse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=".data/test-reports/local-embeddings-benchmark.json",
    )
    parser.add_argument(
        "--sections-per-document",
        type=bounded_integer(1, MAX_SECTIONS_PER_DOCUMENT),
        default=None,
    )
    parser.add_argument(
        "--repetitions",
        type=bounded_integer(1, MAX_REPETITIONS),
        default=5,
    )
    parser.add_argument(
        "--warmup-rounds",
        type=bounded_integer(0, MAX_WARMUP_ROUNDS),
        default=1,
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected an object in {path}")
    return value


def parse_topic(encoded: str) -> tuple[str, str]:
    topic_id, separator, title = encoded.partition("|")
    if not separator or not topic_id or not title:
        raise ValueError(f"Invalid topic definition: {encoded}")
    return topic_id, title


def build_corpus(manifest: dict[str, Any], sections_per_document: int) -> list[dict[str, Any]]:
    section_indexes = SECTION_INDEXES_BY_COUNT.get(sections_per_document)
    if section_indexes is None:
        raise ValueError("sections_per_document is outside the bounded benchmark range")

    sections: list[dict[str, Any]] = []
    section_id = 1
    for source in manifest["sources"]:
        source_key = source["sourceKey"]
        display_name = source["displayName"]
        language = source["language"]
        version_hint = "24" if source_key in {"nodejs", "openjdk"} else "current"
        for encoded_topic in source["topics"]:
            topic_id, title = parse_topic(encoded_topic)
            public_id = f"{source_key}--{topic_id}"
            short_title = " ".join(title.split()[:5])
            for zero_based_index in section_indexes:
                ordinal = zero_based_index + 1
                heading = f"{short_title} {ordinal}"
                heading_path = f"{display_name} > {short_title}"
                content = " ".join(
                    [
                        f"{title}.",
                        f"Official-source benchmark surrogate for {display_name}.",
                        f"Reference version {version_hint}.",
                        f"{title}.",
                        f"Section {ordinal} covers {title} with configuration, API, error handling and operational examples.",
                        f"Stable identifiers: {topic_id} {source_key}.",
                    ]
                )
                sections.append(
                    {
                        "sectionId": section_id,
                        "publicId": public_id,
                        "sourceKey": source_key,
                        "language": language,
                        "title": title,
                        "heading": heading,
                        "headingPath": heading_path,
                        "content": content,
                        "embeddingText": f"{title}\n{heading_path}\n{content}",
                    }
                )
                section_id += 1
    return sections


def create_lexical_database(sections: list[dict[str, Any]]) -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute(
        """
        CREATE VIRTUAL TABLE sections_fts USING fts5(
          section_id UNINDEXED,
          public_id UNINDEXED,
          source_key UNINDEXED,
          language UNINDEXED,
          title,
          heading,
          heading_path,
          content,
          tokenize='unicode61 remove_diacritics 2'
        )
        """
    )
    connection.executemany(
        """
        INSERT INTO sections_fts(
          section_id, public_id, source_key, language, title, heading, heading_path, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                section["sectionId"],
                section["publicId"],
                section["sourceKey"],
                section["language"],
                section["title"],
                section["heading"],
                section["headingPath"],
                section["content"],
            )
            for section in sections
        ],
    )
    return connection


def fts_query(value: str) -> str | None:
    terms = [term.replace('"', "").strip() for term in value.split()]
    terms = [term for term in terms if term]
    if not terms:
        return None
    return " AND ".join(f'"{term.replace(chr(34), chr(34) * 2)}"' for term in terms)


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def lexical_rank(
    connection: sqlite3.Connection,
    query: dict[str, Any],
    limit: int = RESULT_LIMIT,
) -> list[dict[str, Any]]:
    text = query["query"].strip().lower()
    source_key = query.get("sourceKey")
    language = query.get("language")
    pattern = f"%{escape_like(text)}%"
    expression = fts_query(text)
    rows: list[sqlite3.Row | tuple[Any, ...]] = []
    if expression is not None:
        rows = connection.execute(
            """
            SELECT section_id, public_id, bm25(sections_fts) AS rank
            FROM sections_fts
            WHERE sections_fts MATCH ?
              AND (? IS NULL OR source_key = ?)
              AND (? IS NULL OR language = ?)
            ORDER BY rank ASC, title COLLATE NOCASE, section_id ASC
            LIMIT ?
            """,
            (expression, source_key, source_key, language, language, limit),
        ).fetchall()
    if not rows:
        rows = connection.execute(
            """
            SELECT section_id, public_id, 0.0 AS rank
            FROM sections_fts
            WHERE (? IS NULL OR source_key = ?)
              AND (? IS NULL OR language = ?)
              AND (
                lower(title) LIKE ? ESCAPE '\\'
                OR lower(heading) LIKE ? ESCAPE '\\'
                OR lower(heading_path) LIKE ? ESCAPE '\\'
                OR lower(content) LIKE ? ESCAPE '\\'
              )
            ORDER BY
              CASE
                WHEN lower(title) LIKE ? ESCAPE '\\' THEN 4
                WHEN lower(heading) LIKE ? ESCAPE '\\' THEN 3
                WHEN lower(heading_path) LIKE ? ESCAPE '\\' THEN 2
                ELSE 1
              END DESC,
              title COLLATE NOCASE,
              section_id ASC
            LIMIT ?
            """,
            (
                source_key,
                source_key,
                language,
                language,
                pattern,
                pattern,
                pattern,
                pattern,
                pattern,
                pattern,
                pattern,
                limit,
            ),
        ).fetchall()
    return [
        {"sectionId": int(row[0]), "publicId": str(row[1]), "score": float(row[2])}
        for row in rows
    ]


def allowed_indices(sections: list[dict[str, Any]], query: dict[str, Any]) -> np.ndarray:
    source_key = query.get("sourceKey")
    language = query.get("language")
    return np.fromiter(
        (
            index
            for index, section in enumerate(sections)
            if (source_key is None or section["sourceKey"] == source_key)
            and (language is None or section["language"] == language)
        ),
        dtype=np.int64,
    )


def embedding_rank(
    model: StaticModel,
    section_embeddings: np.ndarray,
    sections: list[dict[str, Any]],
    query: dict[str, Any],
    limit: int = RESULT_LIMIT,
) -> list[dict[str, Any]]:
    query_embedding = np.asarray(model.encode([query["query"]]), dtype=np.float32)[0]
    indices = allowed_indices(sections, query)
    if indices.size == 0:
        return []
    scores = section_embeddings[indices] @ query_embedding
    take = min(limit, indices.size)
    if take == indices.size:
        local_order = np.argsort(-scores, kind="stable")
    else:
        candidates = np.argpartition(-scores, take - 1)[:take]
        local_order = candidates[np.argsort(-scores[candidates], kind="stable")]
    ranked_indices = indices[local_order[:take]]
    return [
        {
            "sectionId": int(sections[index]["sectionId"]),
            "publicId": str(sections[index]["publicId"]),
            "score": float(scores[local_order[position]]),
        }
        for position, index in enumerate(ranked_indices)
    ]


def rrf_fusion(
    lexical: list[dict[str, Any]],
    embedding: list[dict[str, Any]],
    limit: int = RESULT_LIMIT,
) -> list[dict[str, Any]]:
    by_section: dict[int, dict[str, Any]] = {}
    for ranking in (lexical, embedding):
        for position, result in enumerate(ranking, start=1):
            section_id = result["sectionId"]
            fused = by_section.setdefault(
                section_id,
                {"sectionId": section_id, "publicId": result["publicId"], "score": 0.0},
            )
            fused["score"] += 1.0 / (RRF_K + position)
    return sorted(
        by_section.values(),
        key=lambda result: (-result["score"], result["sectionId"]),
    )[:limit]


def unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def query_quality(ranking: list[dict[str, Any]], judgments: list[dict[str, Any]]) -> dict[str, float | bool]:
    grades = {judgment["documentPublicId"]: int(judgment["grade"]) for judgment in judgments if int(judgment["grade"]) > 0}
    top10 = unique(str(result["publicId"]) for result in ranking)[:10]
    top5 = top10[:5]
    relevant = set(grades)
    first = next((index for index, document_id in enumerate(top10) if document_id in relevant), None)
    retrieved10 = sum(1 for document_id in top10 if document_id in relevant)
    retrieved5 = sum(1 for document_id in top5 if document_id in relevant)
    actual_grades = [grades.get(document_id, 0) for document_id in top10]
    ideal_grades = sorted(grades.values(), reverse=True)[:10]
    ideal_dcg = dcg(ideal_grades)
    return {
        "reciprocalRankAt10": 0.0 if first is None else 1.0 / (first + 1),
        "ndcgAt10": 1.0 if ideal_dcg == 0 else dcg(actual_grades) / ideal_dcg,
        "recallAt10": 1.0 if not relevant else retrieved10 / len(relevant),
        "precisionAt5": retrieved5 / 5.0,
        "zeroResult": len(ranking) == 0,
    }


def dcg(grades: list[int]) -> float:
    return sum((2**grade - 1) / math.log2(index + 2) for index, grade in enumerate(grades))


def summarize(cases: list[dict[str, Any]]) -> dict[str, Any]:
    count = len(cases)
    if count == 0:
        return {
            "queryCount": 0,
            "mrrAt10": 0.0,
            "ndcgAt10": 0.0,
            "recallAt10": 0.0,
            "precisionAt5": 0.0,
            "zeroResultRate": 0.0,
        }
    return {
        "queryCount": count,
        "mrrAt10": rounded(statistics.fmean(case["reciprocalRankAt10"] for case in cases)),
        "ndcgAt10": rounded(statistics.fmean(case["ndcgAt10"] for case in cases)),
        "recallAt10": rounded(statistics.fmean(case["recallAt10"] for case in cases)),
        "precisionAt5": rounded(statistics.fmean(case["precisionAt5"] for case in cases)),
        "zeroResultRate": rounded(sum(1 for case in cases if case["zeroResult"]) / count),
    }


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(fraction * len(ordered)) - 1))
    return ordered[index]


def latency_summary(values: list[float]) -> dict[str, Any]:
    return {
        "samples": len(values),
        "p50Ms": rounded(percentile(values, 0.50), 3),
        "p95Ms": rounded(percentile(values, 0.95), 3),
        "p99Ms": rounded(percentile(values, 0.99), 3),
        "maxMs": rounded(max(values, default=0.0), 3),
    }


def rounded(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def directory_size(path: Path) -> int:
    return sum(candidate.stat().st_size for candidate in path.rglob("*") if candidate.is_file())


def max_rss_bytes() -> int:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(rss * 1024) if sys.platform != "darwin" else int(rss)


def decide(quality: dict[str, dict[str, Any]], performance: dict[str, Any]) -> dict[str, Any]:
    lexical = quality["lexical"]
    embedding = quality["embedding"]
    fusion = quality["fusion"]
    semantic_gain = max(
        embedding["recallAt10"] - lexical["recallAt10"],
        embedding["ndcgAt10"] - lexical["ndcgAt10"],
        fusion["recallAt10"] - lexical["recallAt10"],
        fusion["ndcgAt10"] - lexical["ndcgAt10"],
    )
    paraphrase_gain = quality["byCategory"].get("paraphrase", {}).get("fusion", {}).get("recallAt10", 0) - quality["byCategory"].get("paraphrase", {}).get("lexical", {}).get("recallAt10", 0)
    multi_gain = quality["byCategory"].get("multi-document", {}).get("fusion", {}).get("recallAt10", 0) - quality["byCategory"].get("multi-document", {}).get("lexical", {}).get("recallAt10", 0)
    performance_ok = performance["fusion"]["p95Ms"] <= 150
    adoption = semantic_gain >= 0.02 and (paraphrase_gain >= 0.10 or multi_gain >= 0.10) and performance_ok
    return {
        "recommendation": "prototype-local-vector-index" if adoption else "keep-fts5-bm25",
        "adoptEmbeddingRuntimeNow": False,
        "prototypeEarned": adoption,
        "semanticQualityGain": rounded(semantic_gain),
        "paraphraseRecallGain": rounded(paraphrase_gain),
        "multiDocumentRecallGain": rounded(multi_gain),
        "fusionP95Within150Ms": performance_ok,
        "reason": (
            "The local embedding candidate earns a product prototype, but runtime integration remains a separate architecture decision with index persistence and packaging gates."
            if adoption
            else "The local embedding candidate does not clear the benchmark gates strongly enough to justify runtime complexity; keep FTS5/BM25 as the product baseline."
        ),
    }


def load_benchmark_inputs(
    args: argparse.Namespace,
) -> tuple[dict[str, Any], list[dict[str, Any]], int, list[dict[str, Any]]]:
    manifest = read_json(MANIFEST_PATH)
    query_set = read_json(QUERIES_PATH)
    queries = query_set.get("queries", [])
    if not isinstance(queries, list) or len(queries) < 60:
        raise ValueError("The local-embedding benchmark requires the reinforced 60-query set")
    sections_per_document = (
        args.sections_per_document
        if args.sections_per_document is not None
        else int(manifest.get("defaultSectionsPerDocument", 100))
    )
    if sections_per_document not in SECTION_INDEXES_BY_COUNT:
        raise ValueError("The manifest sections-per-document value is outside the safe benchmark range")
    sections = build_corpus(manifest, sections_per_document)
    if len(sections) < 10_000:
        raise ValueError("The local-embedding benchmark requires at least 10,000 sections")
    return manifest, queries, sections_per_document, sections


def load_candidate_model() -> tuple[StaticModel, Path]:
    model_cache = Path(os.environ.get("HF_HOME", ROOT / ".data/huggingface"))
    model_path = Path(
        snapshot_download(
            repo_id=MODEL_ID,
            revision=MODEL_REVISION,
            cache_dir=str(model_cache),
        )
    )
    model = StaticModel.from_pretrained(str(model_path))
    return model, model_path


def encode_sections(
    model: StaticModel,
    sections: list[dict[str, Any]],
) -> tuple[list[str], np.ndarray, float]:
    texts = [str(section["embeddingText"]) for section in sections]
    encode_started = time.perf_counter()
    section_embeddings = np.asarray(model.encode(texts), dtype=np.float32)
    encode_duration_ms = (time.perf_counter() - encode_started) * 1000
    if section_embeddings.shape != (len(sections), MODEL_DIMENSIONS):
        raise ValueError(f"Unexpected embedding shape: {section_embeddings.shape}")
    return texts, section_embeddings, encode_duration_ms


def warm_up_searches(
    lexical_db: sqlite3.Connection,
    model: StaticModel,
    section_embeddings: np.ndarray,
    sections: list[dict[str, Any]],
    queries: list[dict[str, Any]],
    warmup_rounds: int,
) -> None:
    for _ in ITERATIONS_BY_COUNT[warmup_rounds]:
        for query in queries:
            lexical_rank(lexical_db, query)
            embedding_rank(model, section_embeddings, sections, query)


def evaluate_quality(
    lexical_db: sqlite3.Connection,
    model: StaticModel,
    section_embeddings: np.ndarray,
    sections: list[dict[str, Any]],
    queries: list[dict[str, Any]],
) -> dict[str, Any]:
    quality_cases: dict[str, list[dict[str, Any]]] = {"lexical": [], "embedding": [], "fusion": []}
    category_cases: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: {"lexical": [], "embedding": [], "fusion": []}
    )
    failures: list[dict[str, Any]] = []
    for query in queries:
        lexical = lexical_rank(lexical_db, query, CANDIDATE_LIMIT)
        embedding = embedding_rank(model, section_embeddings, sections, query, CANDIDATE_LIMIT)
        fusion = rrf_fusion(lexical, embedding, RESULT_LIMIT)
        methods = {
            "lexical": lexical[:RESULT_LIMIT],
            "embedding": embedding[:RESULT_LIMIT],
            "fusion": fusion,
        }
        for method, ranking in methods.items():
            metrics = query_quality(ranking, query["judgments"])
            quality_cases[method].append(metrics)
            category_cases[query["category"]][method].append(metrics)
        if any(quality_cases[method][-1]["recallAt10"] < 1 for method in methods):
            failures.append(
                {
                    "id": query["id"],
                    "category": query["category"],
                    "query": query["query"],
                    "lexicalRecallAt10": rounded(quality_cases["lexical"][-1]["recallAt10"]),
                    "embeddingRecallAt10": rounded(quality_cases["embedding"][-1]["recallAt10"]),
                    "fusionRecallAt10": rounded(quality_cases["fusion"][-1]["recallAt10"]),
                }
            )

    quality: dict[str, Any] = {
        method: summarize(cases) for method, cases in quality_cases.items()
    }
    quality["byCategory"] = {
        category: {method: summarize(cases) for method, cases in methods.items()}
        for category, methods in sorted(category_cases.items())
    }
    quality["failures"] = failures
    return quality


def measure_search_durations(
    lexical_db: sqlite3.Connection,
    model: StaticModel,
    section_embeddings: np.ndarray,
    sections: list[dict[str, Any]],
    queries: list[dict[str, Any]],
    repetitions: int,
) -> dict[str, list[float]]:
    durations: dict[str, list[float]] = {"lexical": [], "embedding": [], "fusion": []}
    for repetition in ITERATIONS_BY_COUNT[repetitions]:
        for query_index, query in enumerate(queries):
            order = (
                ("lexical", "embedding")
                if (repetition + query_index) % 2 == 0
                else ("embedding", "lexical")
            )
            rankings: dict[str, list[dict[str, Any]]] = {}
            for method in order:
                started = time.perf_counter()
                if method == "lexical":
                    rankings[method] = lexical_rank(lexical_db, query, CANDIDATE_LIMIT)
                else:
                    rankings[method] = embedding_rank(
                        model,
                        section_embeddings,
                        sections,
                        query,
                        CANDIDATE_LIMIT,
                    )
                durations[method].append((time.perf_counter() - started) * 1000)
            started = time.perf_counter()
            rrf_fusion(rankings["lexical"], rankings["embedding"], RESULT_LIMIT)
            durations["fusion"].append(
                durations["lexical"][-1]
                + durations["embedding"][-1]
                + (time.perf_counter() - started) * 1000
            )
    return durations


def build_performance_report(
    model: StaticModel,
    model_path: Path,
    texts: list[str],
    section_embeddings: np.ndarray,
    encode_duration_ms: float,
    durations: dict[str, list[float]],
) -> dict[str, Any]:
    incremental_sample = texts[:100]
    incremental_started = time.perf_counter()
    incremental_embeddings = np.asarray(model.encode(incremental_sample), dtype=np.float32)
    incremental_ms = (time.perf_counter() - incremental_started) * 1000

    performance = {method: latency_summary(values) for method, values in durations.items()}
    performance.update(
        {
            "embeddingIndexBuildMs": rounded(encode_duration_ms, 2),
            "embeddingIndexBytes": int(section_embeddings.nbytes),
            "modelSnapshotBytes": directory_size(model_path),
            "memoryMaxRssBytes": max_rss_bytes(),
            "incremental100SectionsMs": rounded(incremental_ms, 2),
            "incremental100SectionsBytes": int(incremental_embeddings.nbytes),
        }
    )
    return performance


def build_report(
    args: argparse.Namespace,
    manifest: dict[str, Any],
    queries: list[dict[str, Any]],
    sections_per_document: int,
    sections: list[dict[str, Any]],
    quality: dict[str, Any],
    performance: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "model2vec": "0.8.2",
            "numpy": np.__version__,
        },
        "candidate": {
            "modelId": MODEL_ID,
            "revision": MODEL_REVISION,
            "license": MODEL_LICENSE,
            "dimensions": MODEL_DIMENSIONS,
            "localOnly": True,
            "productRuntimeDependency": False,
        },
        "corpus": {
            "sourceCount": len(manifest["sources"]),
            "documentCount": sum(len(source["topics"]) for source in manifest["sources"]),
            "sectionCount": len(sections),
            "sectionsPerDocument": sections_per_document,
            "languages": sorted({source["language"] for source in manifest["sources"]}),
            "synthetic": True,
        },
        "protocol": {
            "queryCount": len(queries),
            "warmupRounds": args.warmup_rounds,
            "repetitions": args.repetitions,
            "resultCutoff": RESULT_LIMIT,
            "candidateCutoff": CANDIDATE_LIMIT,
            "fusion": f"reciprocal-rank-fusion-k-{RRF_K}",
        },
        "quality": quality,
        "performance": performance,
    }


def main() -> None:
    args = parse_args()
    manifest, queries, sections_per_document, sections = load_benchmark_inputs(args)
    lexical_db = create_lexical_database(sections)
    try:
        model, model_path = load_candidate_model()
        texts, section_embeddings, encode_duration_ms = encode_sections(model, sections)
        warm_up_searches(
            lexical_db,
            model,
            section_embeddings,
            sections,
            queries,
            args.warmup_rounds,
        )
        quality = evaluate_quality(
            lexical_db,
            model,
            section_embeddings,
            sections,
            queries,
        )
        durations = measure_search_durations(
            lexical_db,
            model,
            section_embeddings,
            sections,
            queries,
            args.repetitions,
        )
        performance = build_performance_report(
            model,
            model_path,
            texts,
            section_embeddings,
            encode_duration_ms,
            durations,
        )
        report = build_report(
            args,
            manifest,
            queries,
            sections_per_document,
            sections,
            quality,
            performance,
        )
    finally:
        lexical_db.close()

    report["decision"] = decide(quality, performance)

    output_path = ROOT / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"Benchmark written to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
