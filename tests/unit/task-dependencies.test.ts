import { describe, expect, it } from 'vitest';

// Cycle check graph implementation matching backend CTE algorithm
function wouldCreateCycle(
  existingEdges: Array<{ from: string; to: string }>,
  newFrom: string,
  newTo: string
): boolean {
  if (newFrom === newTo) return true; // Self-loop

  // Check if newTo can reach newFrom in existing graph
  const visited = new Set<string>();
  const queue = [newTo];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newFrom) return true; // Cycle detected
    visited.add(current);

    const neighbors = existingEdges
      .filter((edge) => edge.from === current)
      .map((edge) => edge.to);

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return false;
}

describe('task dependency cycle detection algorithm', () => {
  it('rejects self dependencies', () => {
    expect(wouldCreateCycle([], 'task_1', 'task_1')).toBe(true);
  });

  it('allows valid acyclic dependency chains', () => {
    const edges = [
      { from: 'task_2', to: 'task_1' },
      { from: 'task_3', to: 'task_2' },
    ];
    // task_4 depends on task_3 -> Valid!
    expect(wouldCreateCycle(edges, 'task_4', 'task_3')).toBe(false);
  });

  it('detects direct 2-node cycle', () => {
    const edges = [{ from: 'task_2', to: 'task_1' }];
    // Attempting task_1 depends on task_2 -> Cycle!
    expect(wouldCreateCycle(edges, 'task_1', 'task_2')).toBe(true);
  });

  it('detects transitive multi-node cycle', () => {
    const edges = [
      { from: 'task_2', to: 'task_1' },
      { from: 'task_3', to: 'task_2' },
      { from: 'task_4', to: 'task_3' },
      { from: 'task_5', to: 'task_4' },
    ];
    // Attempting task_1 depends on task_5 -> Cycle!
    expect(wouldCreateCycle(edges, 'task_1', 'task_5')).toBe(true);
  });

  it('allows diamond dependencies (acyclic DAG)', () => {
    const edges = [
      { from: 'task_B', to: 'task_A' },
      { from: 'task_C', to: 'task_A' },
    ];
    // task_D depends on both task_B and task_C -> Acyclic DAG, perfectly valid!
    expect(wouldCreateCycle(edges, 'task_D', 'task_B')).toBe(false);
    expect(wouldCreateCycle(edges, 'task_D', 'task_C')).toBe(false);
  });
});
