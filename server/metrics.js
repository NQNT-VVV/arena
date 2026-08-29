'use strict';

/**
 * Metriques Prometheus, sur un port distinct du trafic public.
 *
 * Separer les ports evite d'avoir a proteger `/metrics` par un filtre d'URL
 * dans l'ingress : le port n'est simplement pas publie.
 */

const http = require('http');
const client = require('prom-client');

const config = require('./config');

const registry = new client.Registry();
registry.setDefaultLabels({ app: 'arena' });
client.collectDefaultMetrics({ register: registry });

const sessions = new client.Gauge({
  name: 'arena_sessions',
  help: 'Sessions ouvertes, par phase.',
  labelNames: ['phase'],
  registers: [registry],
});

const participants = new client.Gauge({
  name: 'arena_participants_connected',
  help: 'Participants avec au moins une socket ouverte.',
  registers: [registry],
});

const transitions = new client.Counter({
  name: 'arena_phase_transitions_total',
  help: 'Changements de phase, par phase d’arrivee.',
  labelNames: ['to'],
  registers: [registry],
});

const socketErrors = new client.Counter({
  name: 'arena_socket_errors_total',
  help: 'Evenements refuses, par motif.',
  labelNames: ['kind'],
  registers: [registry],
});

/** Les jauges se relisent a la demande plutot que d'etre poussees a chaque evenement. */
function bind(battle) {
  registry.registerCollector = undefined; // pas d'API de collecteur : on echantillonne
  setInterval(() => {
    const byPhase = new Map();
    let online = 0;
    for (const s of battle.sessions.values()) {
      byPhase.set(s.phase, (byPhase.get(s.phase) || 0) + 1);
      for (const p of s.participants.values()) if (s.isOnline(p.id)) online++;
    }
    sessions.reset();
    for (const [phase, n] of byPhase) sessions.set({ phase }, n);
    participants.set(online);
  }, 5000).unref();
}

function serve() {
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': registry.contentType });
    res.end(await registry.metrics());
  });
  server.listen(config.metricsPort, () => {
    console.log(`[arena] metriques sur :${config.metricsPort}/metrics`);
  });
  return server;
}

module.exports = { bind, serve, registry, transitions, socketErrors };
