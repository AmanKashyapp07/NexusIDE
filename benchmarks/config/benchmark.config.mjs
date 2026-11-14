export const benchmarkConfig = {
  iterations: {
    codec: 10000,
    terminal: 100,
    merkle: 1000,
    redis: 1000,
    postgres: 500,
    yjsLocal: 1000,
    yjsDistributed: 50,
    dockerPool: 5
  },
  warmupIterations: {
    codec: 1000,
    merkle: 100,
    redis: 100,
    postgres: 50
  },
  timeouts: {
    defaultTestMs: 60000,
    dockerSpinupMs: 120000
  },
  ports: {
    terminalWsBenchmark: 49152,
    yjsWsBenchmark: 49153
  },
  namespaces: {
    redisBenchmarkKeyPrefix: 'bench:v2:',
    postgresBenchmarkSchema: 'public'
  }
};
