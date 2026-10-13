# Airports

`airports.csv` — medium and large airports with an IATA code (code, name, city, ISO country, latitude,
longitude, large). `countries.csv` — ISO country codes and names.

Source: OurAirports (https://ourairports.com/data/), released into the public domain, as packaged in
the npm package `airports-json` 1.0.0 (medium and large airports). Used to work out flight distances
(great-circle + 8% for routing, as DESNZ advises) and whether a flight is domestic.

Regenerate from a newer OurAirports export if airports open or change codes.
