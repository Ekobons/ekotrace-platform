/**
 * Business travel (Scope 3.6): what the entry screen needs.
 *
 *   GET /api/trips/airports?q=   airports by code, city, name or country (OurAirports)
 *   GET /api/trips/distance?from=&to=   great-circle km, + 8%, and the DESNZ haul
 *   GET /api/trips/options?year= hotel countries (with the room-night factor of the year, or the latest
 *                                before it), other transport (rail, bus, taxi, car, ferry), classes,
 *                                the company's radiative-forcing choice, typical distances
 *
 * The calculation itself is in calc.service (resolveTrip): entries are saved through /api/activities.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { requireTenant } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { airport, greatCircleKm, haulOf, searchAirports, UPLIFT, SHORT_HAUL_MAX_KM } from '../lib/airports.js';
import { tenantSettings } from './activity.routes.js';

export const TRIP_CLASSES = [['economy', 'Economy'], ['premium', 'Premium economy'], ['business', 'Business'], ['first', 'First'], ['average', 'Not known (average)']] as const;
export const TRIP_HAULS = [['domestic', 'Domestic (within one country)'], ['intl', 'International'], ['short', 'Short-haul to/from the UK (under 3,700 km)'], ['long', 'Long-haul to/from the UK']] as const;
export const TYPICAL_KM: Record<string, number> = { domestic: 450, short: 1500, long: 6500, intl: 3000 };

export async function tripRoutes(app: FastifyInstance) {
  app.get('/api/trips/airports', async (req) => {
    const q = z.object({ q: z.string().max(60).default('') }).parse(req.query);
    return { airports: searchAirports(q.q, 12).map((a) => ({ iata: a.iata, name: a.name, city: a.city, country: a.country, countryName: a.countryName })) };
  });

  app.get('/api/trips/distance', async (req) => {
    const q = z.object({ from: z.string().length(3), to: z.string().length(3) }).parse(req.query);
    const a = airport(q.from), b = airport(q.to);
    if (!a || !b) throw new AppError(`Airport ${!a ? q.from.toUpperCase() : q.to.toUpperCase()} not found`);
    const gc = greatCircleKm(a, b);
    return { from: a.iata, to: b.iata, gcKm: Math.round(gc), km: Math.round(gc * UPLIFT), haul: haulOf(a, b, gc) };
  });

  app.get('/api/trips/options', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) }).parse(req.query);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      // Hotel countries with the factor that applies in the year (that year's, or the latest before it).
      const hotels = (await c.query(
        `SELECT i.id, i.name, i.attrs->>'country' AS country, i.attrs->>'iso' AS iso,
                (SELECT f.co2e::float8 FROM factor f WHERE f.item_id = i.id AND f.status = 'active' AND f.valid_from <= make_date($1, 12, 31) ORDER BY f.valid_from DESC LIMIT 1) AS co2e,
                (SELECT extract(year FROM f.valid_from)::int FROM factor f WHERE f.item_id = i.id AND f.status = 'active' AND f.valid_from <= make_date($1, 12, 31) ORDER BY f.valid_from DESC LIMIT 1) AS fyear
           FROM item i JOIN subcategory s ON s.id = i.subcategory_id WHERE s.code = 'bt_hotel' AND i.active ORDER BY i.attrs->>'country'`, [q.year])).rows;
      const ground = (await c.query(
        `SELECT i.id, i.code, i.name, s.code AS sub, s.name AS sub_name, s.default_unit AS unit, i.note FROM item i JOIN subcategory s ON s.id = i.subcategory_id
          WHERE s.code IN ('bt_rail', 'bt_bus', 'bt_taxi', 'bt_car', 'bt_sea') AND i.active AND EXISTS (SELECT 1 FROM factor f WHERE f.item_id = i.id AND f.status = 'active')
          ORDER BY s.sort, i.sort, i.name`)).rows;
      return {
        rf: t.flight_rf, classes: TRIP_CLASSES.map(([key, label]) => ({ key, label })), hauls: TRIP_HAULS.map(([key, label]) => ({ key, label })), typicalKm: TYPICAL_KM,
        uplift: UPLIFT, shortHaulMaxKm: SHORT_HAUL_MAX_KM, country: t.country,
        hotels: hotels.map((h) => ({ itemId: h.id, country: h.country, iso: h.iso, co2e: h.co2e, factorYear: h.fyear })),
        ground: ground.map((g) => ({ itemId: g.id, code: g.code, name: g.name, group: g.sub_name, sub: g.sub, unit: g.unit, note: g.note })),
      };
    });
  });
}
