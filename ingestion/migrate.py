import os
from dotenv import load_dotenv
from supabase import create_client
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    VectorParams,
    PointStruct,
)
from tqdm import tqdm

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", 200))

print("SUPABASE_URL", SUPABASE_URL)
print("SUPABASE_KEY", SUPABASE_KEY)
print("QDRANT_URL", QDRANT_URL)
print("QDRANT_API_KEY", QDRANT_API_KEY)
print("BATCH_SIZE", BATCH_SIZE)

COLLECTION_NAME = "fia_documents"
VECTOR_SIZE = 1536

import json

def parse_embedding(embedding):
    """
    Converts pgvector string or list into list[float]
    """
    if isinstance(embedding, list):
        return embedding
    if isinstance(embedding, str):
        return json.loads(embedding)
    raise TypeError(f"Unexpected embedding type: {type(embedding)}")


# -------------------------------
# Clients
# -------------------------------
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

qdrant = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
)

# -------------------------------
# Ensure Qdrant Collection
# -------------------------------
existing = [c.name for c in qdrant.get_collections().collections]

if COLLECTION_NAME not in existing:
    print("Creating Qdrant collection...")
    qdrant.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=VECTOR_SIZE,
            distance=Distance.COSINE,
        ),
    )
else:
    print("Qdrant collection already exists.")

# -------------------------------
# Fetch total count
# -------------------------------
count_resp = supabase.table("fia_documents").select("id", count="exact").execute()
total_rows = count_resp.count
print(f"Total rows in Supabase: {total_rows}")

# -------------------------------
# Migration Loop
# -------------------------------
offset = 0
migrated = 0

with tqdm(total=total_rows) as pbar:
    while True:
        resp = (
            supabase.table("fia_documents")
            .select("*")
            .range(offset, offset + BATCH_SIZE - 1)
            .execute()
        )

        rows = resp.data
        if not rows:
            break

        points = []

        for row in rows:
            point_id = row["id"]

            # Check if already exists in Qdrant
            exists = qdrant.retrieve(
                collection_name=COLLECTION_NAME,
                ids=[point_id],
            )

            if exists:
                pbar.update(1)
                continue
            vec = parse_embedding(row["embedding"])
            if len(vec) != VECTOR_SIZE:
                raise ValueError(f"Bad vector size: {len(vec)}")
            points.append(
                PointStruct(
                    id=point_id,
                    vector=vec,
                    payload={
                        "year": row["year"],
                        "type": row["type"],
                        "source": row["source"],
                        "date": row["date"],
                        "content": row["content"],
                    },
                )
            )

        if points:
            qdrant.upsert(
                collection_name=COLLECTION_NAME,
                points=points,
            )
            migrated += len(points)

        offset += BATCH_SIZE
        pbar.update(len(rows))

print(f"\nMigration complete. Migrated {migrated} vectors to Qdrant.")
