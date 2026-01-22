"""
Create Payload Indexes in Qdrant
=================================
Creates all required indexes for filtering FIA documents.

Indexes:
- year (integer) - Document year
- season (integer) - F1 season year
- type (keyword) - Document type (decision, summons, classification, etc.)
- category (keyword) - Category (race, regulation, etc.)
- championship (keyword) - Championship (f1, f2, f3)
- source (keyword) - Source filename
- published_date (keyword) - ISO date string
- race (keyword) - Grand Prix name

Usage:
    python create_indexes.py
"""

import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "fia_documents"

print(f"Connecting to Qdrant at {QDRANT_URL}...")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
)

print(f"\nCreating payload indexes for collection '{COLLECTION_NAME}'...")

# Define all indexes
INDEXES = [
    ("year", "integer"),
    ("season", "integer"),
    ("type", "keyword"),
    ("category", "keyword"),
    ("championship", "keyword"),
    ("source", "keyword"),
    ("published_date", "keyword"),
    ("race", "keyword"),
]

for field_name, field_schema in INDEXES:
    try:
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name=field_name,
            field_schema=field_schema,
        )
        print(f"✅ Created index for '{field_name}' ({field_schema})")
    except Exception as e:
        print(f"⚠️  Index for '{field_name}' might already exist: {str(e)[:50]}")

print("\n✅ Payload indexes created successfully!")
print("\nAvailable filters:")
print("  - year: Filter by document year (integer)")
print("  - season: Filter by F1 season (integer)")
print("  - type: decision | summons | classification | lap-deletion | protest | etc.")
print("  - category: race | regulation | etc.")
print("  - championship: f1 | f2 | f3")
print("  - source: Filter by filename")
print("  - published_date: Filter by ISO date (YYYY-MM-DD)")
print("  - race: Filter by Grand Prix name")
