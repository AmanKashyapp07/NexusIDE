export interface ConflictBlock {
  type: 'unchanged' | 'conflict';
  content?: string; // For unchanged
  ours?: string;    // For conflict
  theirs?: string;  // For conflict
  ourLabel?: string;
  theirLabel?: string;
}

export function parseConflicts(fileContent: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  const lines = fileContent.split('\n');
  
  let currentBlockType: 'unchanged' | 'ours' | 'theirs' = 'unchanged';
  let unchangedBuffer: string[] = [];
  let oursBuffer: string[] = [];
  let theirsBuffer: string[] = [];
  let ourLabel = '';
  let theirLabel = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line === undefined) continue;
    line = line.replace(/\r$/, '');

    if (line.startsWith('<<<<<<< ')) {
      if (unchangedBuffer.length > 0) {
        blocks.push({
          type: 'unchanged',
          content: unchangedBuffer.join('\n')
        });
        unchangedBuffer = [];
      }
      currentBlockType = 'ours';
      ourLabel = line.substring(8).trim();
    } else if (line === '=======') {
      currentBlockType = 'theirs';
    } else if (line.startsWith('>>>>>>> ')) {
      theirLabel = line.substring(8).trim();
      blocks.push({
        type: 'conflict',
        ours: oursBuffer.join('\n'),
        theirs: theirsBuffer.join('\n'),
        ourLabel,
        theirLabel
      });
      oursBuffer = [];
      theirsBuffer = [];
      ourLabel = '';
      theirLabel = '';
      currentBlockType = 'unchanged';
    } else {
      if (currentBlockType === 'unchanged') {
        unchangedBuffer.push(line);
      } else if (currentBlockType === 'ours') {
        oursBuffer.push(line);
      } else if (currentBlockType === 'theirs') {
        theirsBuffer.push(line);
      }
    }
  }

  if (unchangedBuffer.length > 0) {
    blocks.push({
      type: 'unchanged',
      content: unchangedBuffer.join('\n')
    });
  }

  return blocks;
}
