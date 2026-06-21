// api/system/strategy.js — Venue strategy configuration endpoints
// GET /api/system/strategy → get active venue params
// POST /api/system/strategy → switch venue or update params

import db from '../../server/db/database.mjs';
import {
  getActiveVenue,
  getStrategyParams,
  setActiveVenue,
  updateStrategyParams,
  getAllVenues,
  getActiveSummary,
} from '../../server/strategy/strategyParams.mjs';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const summary = getActiveSummary();
      res.json({
        ok: true,
        active: getActiveVenue(),
        params: getStrategyParams(),
        summary,
        allVenues: getAllVenues(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  } else if (req.method === 'POST') {
    try {
      const { action, venue, updates } = req.body;

      if (action === 'switch') {
        // Switch active venue
        if (!venue) throw new Error('venue required for switch');
        const newParams = setActiveVenue(venue);
        res.json({
          ok: true,
          message: `switched to ${venue}`,
          params: newParams,
        });
      } else if (action === 'update') {
        // Update params for specific venue
        if (!venue || !updates) throw new Error('venue and updates required');
        const updated = updateStrategyParams(venue, updates);
        res.json({
          ok: true,
          message: `updated ${venue}`,
          params: updated,
        });
      } else {
        throw new Error('action must be "switch" or "update"');
      }
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  } else {
    res.status(405).json({ ok: false, error: 'method not allowed' });
  }
}
