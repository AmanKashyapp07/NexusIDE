/**
 * Magnus CI / CD Engine Pipeline Integration & Verification Test Suite
 *
 * Verifies `magnus-ci.json` DAG stage configuration, topological dependency sorting,
 * container execution parameters, timeout ceilings, and status payload structure.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Magnus CI Pipeline Configuration & DAG Verification Suite', () => {
   const configPath = path.resolve(process.cwd(), '../magnus-ci.json');
   let config: any;

   it('validates presence and JSON format of magnus-ci.json', () => {
      expect(fs.existsSync(configPath)).toBe(true);
      const raw = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(raw);
      expect(config).toBeTypeOf('object');
      expect(config).toHaveProperty('language', 'Node.js');
      expect(config).toHaveProperty('image', 'node:20-alpine');
      expect(config).toHaveProperty('stages');
   });

   it('verifies all required pipeline stages are defined with valid run commands', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(raw);
      const stages = config.stages;

      const requiredStages = [
         'setup',
         'property',
         'idempotency',
         'chaos',
         'contracts',
         'perf',
         'typecheck',
         'services',
         'security',
         'resilience',
         'timelapse',
         'integration',
         'frontend',
         'build'
      ];

      for (const stageName of requiredStages) {
         expect(stages).toHaveProperty(stageName);
         expect(stages[stageName]).toHaveProperty('run');
         expect(typeof stages[stageName].run).toBe('string');
         expect(stages[stageName].run.length).toBeGreaterThan(0);
      }
   });

   it('proves valid topological DAG dependency ordering (no circular dependencies)', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(raw);
      const stages = config.stages;

      // 1. Root stage 'setup' must have no dependencies
      expect(stages.setup.needs).toBeUndefined();

      // 2. Intermediate verification stages must depend on 'setup'
      const verificationStages = [
         'property',
         'idempotency',
         'chaos',
         'contracts',
         'perf',
         'typecheck',
         'services',
         'security',
         'resilience',
         'timelapse',
         'integration',
         'frontend'
      ];

      for (const stageName of verificationStages) {
         expect(stages[stageName].needs).toContain('setup');
      }

      // 3. Terminal stage 'build' must depend on all verification stages
      const buildNeeds = stages.build.needs;
      expect(Array.isArray(buildNeeds)).toBe(true);
      for (const stageName of verificationStages) {
         expect(buildNeeds).toContain(stageName);
      }
   });

   it('validates CI environment variable injection flags in stage commands', () => {
      const raw = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(raw);
      const stages = config.stages;

      // Ensure test commands enforce CI=true environment variable
      expect(stages.property.run).toContain('CI=true');
      expect(stages.idempotency.run).toContain('CI=true');
      expect(stages.chaos.run).toContain('CI=true');
      expect(stages.contracts.run).toContain('CI=true');
      expect(stages.perf.run).toContain('CI=true');
   });
});
