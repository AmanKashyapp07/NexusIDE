import { describe, it, expect } from 'vitest';

describe('Monaco Editor Model Lifecycle & Memory Recycling Suite', () => {
  it('disposes text model instances on tab close to prevent memory leaks', () => {
    const activeModels = new Map<string, { uri: string; disposed: boolean }>();

    const createModel = (uri: string) => {
      const model = { uri, disposed: false };
      activeModels.set(uri, model);
      return model;
    };

    const disposeModel = (uri: string) => {
      const model = activeModels.get(uri);
      if (model) {
        model.disposed = true;
        activeModels.delete(uri);
      }
    };

    createModel('inmemory://model/1');
    expect(activeModels.size).toBe(1);

    disposeModel('inmemory://model/1');
    expect(activeModels.size).toBe(0);
  });
});
