"""
Export a static civic-signals dataset from local Neo4j.

The generated JSON is designed for GitHub Pages: the dashboard reads this file
directly and does not connect to Neo4j at runtime.

Usage:
    python export_civic_signals.py --password neoadmin
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from neo4j import GraphDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("civic-export")


META_QUERY = """
MATCH (c:Crime)
WITH count(c) AS total_crimes, min(c.datetime) AS earliest, max(c.datetime) AS latest
MATCH (s:ServiceRequest)
WITH total_crimes, earliest, latest, count(s) AS total_311
MATCH (st:Station)
RETURN total_crimes, total_311, count(st) AS stations, earliest, latest
"""


COMMUNITY_QUERY = """
MATCH (ca:CommunityArea)
OPTIONAL MATCH (ca)<-[:IN]-(:Block)<-[:AT_BLOCK]-(c:Crime)
WITH ca, count(DISTINCT c) AS crimes
OPTIONAL MATCH (ca)<-[:IN]-(:Block)<-[:AT_BLOCK]-(sd:ServiceRequest)-[:OF_REQUEST_TYPE]->(:RequestType {category: 'disorder'})
WITH ca, crimes, count(DISTINCT sd) AS disorder311
OPTIONAL MATCH (ca)<-[:IN]-(:Block)<-[:AT_BLOCK]-(si:ServiceRequest)-[:OF_REQUEST_TYPE]->(:RequestType {category: 'infrastructure'})
WITH ca, crimes, disorder311, count(DISTINCT si) AS infrastructure311
OPTIONAL MATCH (ca)<-[:IN]-(:Block)<-[:AT_BLOCK]-(c2:Crime)-[:OF_TYPE]->(pt:PrimaryType)
WITH ca, crimes, disorder311, infrastructure311, pt.name AS type, count(DISTINCT c2) AS type_count
ORDER BY ca.number, type_count DESC
WITH ca, crimes, disorder311, infrastructure311,
     collect({type: type, count: type_count})[0..4] AS topTypes
RETURN ca.number AS number,
       ca.cmapName AS name,
       ca.crimeCluster AS cluster,
       crimes,
       disorder311,
       infrastructure311,
       round(1000.0 * disorder311 / CASE WHEN crimes = 0 THEN 1 ELSE crimes END, 1) AS disorderPer1kCrimes,
       round(1000.0 * infrastructure311 / CASE WHEN crimes = 0 THEN 1 ELSE crimes END, 1) AS infrastructurePer1kCrimes,
       ca.medianIncome AS medianIncome,
       ca.pctNoVehicle AS pctNoVehicle,
       ca.pctVacant AS pctVacant,
       topTypes
ORDER BY ca.number
"""


DISORDER_BINS_QUERY = """
WITH date('2026-03-03') AS split_date
MATCH (b:Block)
OPTIONAL MATCH (b)<-[:AT_BLOCK]-(s1:ServiceRequest)-[:OF_REQUEST_TYPE]->(:RequestType {category: 'disorder'})
WHERE date(s1.datetime) < split_date
WITH b, split_date, count(DISTINCT s1) AS disorder
OPTIONAL MATCH (b)<-[:AT_BLOCK]-(s2:ServiceRequest)-[:OF_REQUEST_TYPE]->(:RequestType {category: 'infrastructure'})
WHERE date(s2.datetime) < split_date
WITH b, split_date, disorder, count(DISTINCT s2) AS infrastructure
OPTIONAL MATCH (b)<-[:AT_BLOCK]-(c:Crime)
WHERE date(c.datetime) >= split_date
WITH b, disorder, infrastructure, count(DISTINCT c) AS lateCrimes
WITH CASE
       WHEN disorder = 0 THEN '0'
       WHEN disorder = 1 THEN '1'
       WHEN disorder <= 3 THEN '2-3'
       WHEN disorder <= 7 THEN '4-7'
       ELSE '8+'
     END AS bin,
     disorder, infrastructure, lateCrimes
RETURN bin,
       count(*) AS blocks,
       round(avg(disorder), 2) AS avgDisorder,
       round(avg(infrastructure), 2) AS avgInfrastructure,
       round(avg(lateCrimes), 3) AS avgLateCrimes,
       round(100.0 * sum(CASE WHEN lateCrimes > 0 THEN 1 ELSE 0 END) / count(*), 2) AS pctBlocksWithLateCrime
ORDER BY CASE bin WHEN '0' THEN 0 WHEN '1' THEN 1 WHEN '2-3' THEN 2 WHEN '4-7' THEN 3 ELSE 4 END
"""


REQUEST_TYPES_QUERY = """
MATCH (s:ServiceRequest)-[:OF_REQUEST_TYPE]->(rt:RequestType)
RETURN rt.name AS type, rt.category AS category, count(s) AS count
ORDER BY count DESC
"""


REQUEST_CRIME_PAIRS_QUERY = """
MATCH (s:ServiceRequest)-[:OF_REQUEST_TYPE]->(rt:RequestType {category:'disorder'}),
      (s)-[:AT_BLOCK]->(b:Block)<-[:AT_BLOCK]-(c:Crime)-[:OF_TYPE]->(pt:PrimaryType)
WHERE c.datetime > s.datetime
  AND duration.between(s.datetime, c.datetime).days <= 14
WITH rt.name AS requestType, pt.name AS crimeType, count(DISTINCT c) AS count
WHERE count >= 150
RETURN requestType, crimeType, count
ORDER BY count DESC
LIMIT 24
"""


STATIONS_QUERY = """
MATCH (st:Station)-[:NEAR]->(b:Block)
WITH st, collect(DISTINCT b) AS blocks
OPTIONAL MATCH (c:Crime)-[:AT_BLOCK]->(bc:Block)
WHERE bc IN blocks
WITH st, blocks, count(DISTINCT c) AS crimes
OPTIONAL MATCH (s:ServiceRequest)-[:AT_BLOCK]->(bs:Block)
WHERE bs IN blocks
OPTIONAL MATCH (s)-[:OF_REQUEST_TYPE]->(:RequestType {category:'disorder'})
WITH st, crimes, count(DISTINCT s) AS disorder311
WHERE crimes >= 50
RETURN st.mapId AS mapId,
       st.name AS name,
       crimes,
       disorder311,
       round(1.0 * disorder311 / CASE WHEN crimes = 0 THEN 1 ELSE crimes END, 2) AS disorderToCrimeRatio
ORDER BY disorderToCrimeRatio DESC
LIMIT 24
"""


BLOCKS_QUERY = """
WITH date('2026-03-03') AS split_date
MATCH (st:Station)-[:NEAR]->(b:Block)
WITH split_date, b, collect(DISTINCT st.name)[0..3] AS stations
OPTIONAL MATCH (b)<-[:AT_BLOCK]-(s:ServiceRequest)-[:OF_REQUEST_TYPE]->(:RequestType {category:'disorder'})
WHERE date(s.datetime) < split_date
WITH split_date, b, stations, count(DISTINCT s) AS priorDisorder
OPTIONAL MATCH (b)<-[:AT_BLOCK]-(c:Crime)-[:OF_TYPE]->(pt:PrimaryType)
WHERE date(c.datetime) >= split_date
WITH b, stations, priorDisorder, count(DISTINCT c) AS laterCrimes,
     collect(DISTINCT pt.name)[0..5] AS laterTypes
WHERE priorDisorder >= 4 AND laterCrimes >= 4
RETURN b.address AS block, stations, priorDisorder, laterCrimes, laterTypes
ORDER BY laterCrimes DESC, priorDisorder DESC
LIMIT 20
"""


def serial(value):
    if hasattr(value, "iso_format"):
        return value.iso_format()
    if isinstance(value, list):
        return [serial(v) for v in value]
    if isinstance(value, dict):
        return {k: serial(v) for k, v in value.items()}
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uri", default="bolt://localhost:7687")
    parser.add_argument("--user", default="neo4j")
    parser.add_argument("--password", required=True)
    parser.add_argument("--out", type=Path, default=Path("public/data/civic-signals.json"))
    args = parser.parse_args()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    driver = GraphDatabase.driver(args.uri, auth=(args.user, args.password))
    driver.verify_connectivity()

    with driver.session() as s:
      meta = s.run(META_QUERY).single()
      data = {
          "meta": {
              "totalCrimes": int(meta["total_crimes"]),
              "total311": int(meta["total_311"]),
              "stations": int(meta["stations"]),
              "earliest": serial(meta["earliest"]),
              "latest": serial(meta["latest"]),
              "splitDate": "2026-03-03",
          },
          "communityAreas": [dict(r) for r in s.run(COMMUNITY_QUERY)],
          "disorderBins": [dict(r) for r in s.run(DISORDER_BINS_QUERY)],
          "requestTypes": [dict(r) for r in s.run(REQUEST_TYPES_QUERY)],
          "requestCrimePairs": [dict(r) for r in s.run(REQUEST_CRIME_PAIRS_QUERY)],
          "stationCatchments": [dict(r) for r in s.run(STATIONS_QUERY)],
          "threeLayerBlocks": [dict(r) for r in s.run(BLOCKS_QUERY)],
      }

    driver.close()

    args.out.write_text(json.dumps(serial(data), separators=(",", ":")), encoding="utf-8")
    log.info("wrote %s (%d KB)", args.out, round(args.out.stat().st_size / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
