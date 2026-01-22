"""
Inspect Ingested Data in Qdrant
================================
View and search through the ingested FIA documents.

Usage:
    python inspect_data.py              # Show collection stats and sample documents
    python inspect_data.py --search "safety car"  # Search for specific content
    python inspect_data.py --year 2021  # Filter by year
    python inspect_data.py --type sporting  # Filter by type
"""

import os
import argparse
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http.models import Filter, FieldCondition, MatchValue
import json

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "fia_documents"

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("Missing Qdrant credentials (QDRANT_URL, QDRANT_API_KEY)")

# Initialize client
qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)


def get_collection_info():
    """Get collection statistics."""
    info = qdrant.get_collection(COLLECTION_NAME)
    return {
        "total_points": info.points_count,
        "status": info.status,
    }


def get_sample_documents(limit: int = 5, year: int = None, doc_type: str = None):
    """Get sample documents with optional filters."""
    filters = []
    
    if year:
        filters.append(FieldCondition(key="year", match=MatchValue(value=year)))
    if doc_type:
        filters.append(FieldCondition(key="type", match=MatchValue(value=doc_type)))
    
    scroll_filter = Filter(must=filters) if filters else None
    
    result = qdrant.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=scroll_filter,
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    
    return result[0]  # Returns list of points


def get_unique_sources():
    """Get list of unique source files."""
    sources = set()
    offset = None
    
    while True:
        result = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            offset=offset,
            with_payload=["source"],
            with_vectors=False,
        )
        
        points, next_offset = result
        for point in points:
            sources.add(point.payload.get("source", "unknown"))
        
        if next_offset is None:
            break
        offset = next_offset
    
    return sorted(sources)


def get_type_distribution():
    """Get count of documents by type."""
    types = {}
    offset = None
    
    while True:
        result = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            offset=offset,
            with_payload=["type"],
            with_vectors=False,
        )
        
        points, next_offset = result
        for point in points:
            doc_type = point.payload.get("type", "unknown")
            types[doc_type] = types.get(doc_type, 0) + 1
        
        if next_offset is None:
            break
        offset = next_offset
    
    return types


def format_document(point, index: int):
    """Format a document for display."""
    payload = point.payload
    content_preview = payload.get("content", "")[:200] + "..." if len(payload.get("content", "")) > 200 else payload.get("content", "")
    
    return f"""
{'='*60}
Document #{index + 1} (ID: {point.id})
{'='*60}
📁 Source:     {payload.get('source', 'N/A')}
🔗 URL:        {payload.get('source_url', 'N/A')}
📅 Year:       {payload.get('year', 'N/A')}
🏷️  Type:       {payload.get('type', 'N/A')}
📆 Date:       {payload.get('date', 'N/A')}

📝 Content Preview:
{content_preview}
"""


def main():
    parser = argparse.ArgumentParser(description="Inspect ingested FIA documents in Qdrant")
    parser.add_argument("--limit", type=int, default=5, help="Number of documents to show")
    parser.add_argument("--year", type=int, help="Filter by year")
    parser.add_argument("--type", type=str, choices=["sporting", "technical", "financial", "other"], help="Filter by type")
    parser.add_argument("--sources", action="store_true", help="List all unique source files")
    parser.add_argument("--stats", action="store_true", help="Show detailed statistics")
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("📊 QDRANT COLLECTION INSPECTOR")
    print("="*60)
    
    # Collection info
    info = get_collection_info()
    print(f"\n📦 Collection: {COLLECTION_NAME}")
    print(f"   Total Points: {info['total_points']:,}")
    print(f"   Status: {info['status']}")
    
    if args.stats:
        print("\n📈 Type Distribution:")
        types = get_type_distribution()
        for doc_type, count in sorted(types.items(), key=lambda x: -x[1]):
            print(f"   - {doc_type}: {count:,} chunks")
    
    if args.sources:
        print("\n📁 Unique Source Files:")
        sources = get_unique_sources()
        for i, source in enumerate(sources, 1):
            print(f"   {i}. {source}")
        print(f"\n   Total: {len(sources)} files")
        return
    
    # Get sample documents
    print(f"\n🔍 Sample Documents (limit={args.limit}):")
    if args.year:
        print(f"   Filter: year={args.year}")
    if args.type:
        print(f"   Filter: type={args.type}")
    
    documents = get_sample_documents(limit=args.limit, year=args.year, doc_type=args.type)
    
    if not documents:
        print("\n   ⚠️  No documents found matching filters.")
        return
    
    for i, doc in enumerate(documents):
        print(format_document(doc, i))
    
    print("\n" + "="*60)
    print(f"Showing {len(documents)} of {info['total_points']:,} total documents")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
