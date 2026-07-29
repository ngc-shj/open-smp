import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
          // The parity gate spawns one child per (member, tier) and grows with
          // the workspace. Measured at ~0.6s on a warm 18-core machine; CI runs
          // on 2 vCPU with a cold cache, and the same listings serialised are
          // already ~2.2s locally. vitest's 5s default would make that a
          // timeout that reads as a parity failure.
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['**/*.integration.test.ts'],
          exclude: ['**/node_modules/**'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // No pool declaration: the default is what this tier wants, and
          // saying so is the point.
          //
          // This block used to read `pool: 'forks', poolOptions: { forks: {
          // singleFork: true } }`. Under vitest 4 the `poolOptions` key is
          // removed, and its presence made vitest discard the surrounding pool
          // declaration entirely — so neither `forks` nor `singleFork` was ever
          // in effect, and the tier had been running on the default pool while
          // the config claimed otherwise. Deleting only `poolOptions` (the
          // obvious repair) leaves `pool: 'forks'` newly effective and doubles
          // the tier's wall clock. Measured, six files / 143 tests:
          //
          //   forks + poolOptions (the old text)  7.2s   + a deprecation warning
          //   forks alone                        13.8s
          //   fileParallelism: false             14.1s
          //   no pool key (this)                  7.2s
          //
          // Parallel is correct here: every integration file provisions its own
          // Testcontainers instances, so there is no shared database to contend
          // over and nothing for serialisation to buy.
        },
      },
    ],
  },
});
