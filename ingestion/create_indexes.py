"""
Create Qdrant Collection + Payload Indexes
===========================================
Matches the live fia_documents schema:
- 1024-dim voyage-4 vectors, Cosine distance
- Payload: doc_type, season, section, event, doc_number, ...
"""

import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models

load_dotenv(dotenv_path="main/.env.local")

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
COLLECTION_NAME = "fia_documents"
VECTOR_SIZE = 1024

print(f"Connecting to Qdrant at {QDRANT_URL}...")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
)

# 1. Ensure Collection Exists
try:
    if not client.collection_exists(collection_name=COLLECTION_NAME):
        print(f"Collection '{COLLECTION_NAME}' does not exist. Creating...")
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=models.VectorParams(
                size=VECTOR_SIZE,
                distance=models.Distance.COSINE
            )
        )
        print(f"OK: Created collection '{COLLECTION_NAME}'")
    else:
        print(f"Collection '{COLLECTION_NAME}' already exists.")
except Exception as e:
    print(f"FAIL: Error checking/creating collection: {e}")

print(f"\nCreating payload indexes for collection '{COLLECTION_NAME}'...")

# Payload indexes used by the RAG retriever's filters.
# NOTE: `season` is a KEYWORD index, not integer — the live collection
# stores season as a string ("2024"). An integer index never matches.
INDEXES = [
    ("season", "keyword"),  # season filter (string match)
    ("section", "keyword"),   # Sporting / Technical / Financial (+ variants)
    ("doc_type", "keyword"),  # regulation | decision
    ("event", "keyword"),     # Grand Prix event name (decisions)
    ("doc_number", "keyword"),
]

for field_name, field_schema in INDEXES:
    try:
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name=field_name,
            field_schema=field_schema,
        )
        print(f"OK: Created index for '{field_name}' ({field_schema})")
    except Exception as e:
        print(f"WARN:  Index for '{field_name}' might already exist or failed: {e}")

print("\nOK: Payload indexes check/creation complete!")
print("\nYou can now run queries filtered on season, section, doc_type, and event.")
