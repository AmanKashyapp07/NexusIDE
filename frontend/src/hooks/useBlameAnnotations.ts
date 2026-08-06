import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type * as Monaco from 'monaco-editor';
import * as Y from 'yjs';
import { fetchFileHistory } from '../api/history';
import { getNexusToken } from '../lib/tokenStorage';

export interface AwarenessUser { name: string; color: string; id?: string; }
export type AwarenessState = [number, { user?: AwarenessUser; selection?: { anchor: unknown; head: unknown } }];

interface UseBlameAnnotationsOptions {
  workspaceId: string;
  fileId: string;
  isBlameOpen?: boolean;
  onBlameToggle?: (open: boolean) => void;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  ydoc: Y.Doc | null;
  awarenessStates: AwarenessState[];
  authorMap?: Record<string, { userId?: string; username: string; color: string }>;
}

export function getChronologicalLineBlame(ytext: Y.Text) {
  const lineAuthors = new Map<number, Map<number, number>>();
  let currentLine = 1;
  let node: any = (ytext as any)._start;

  while (node !== null) {
    if (!node.deleted) {
      const content = node.content?.getContent?.();
      const str = Array.isArray(content) ? content.join('') : (typeof content === 'string' ? content : '');

      for (let i = 0; i < str.length; i++) {
        if (str[i] === '\n') {
          currentLine++;
        } else {
          const clientId = node.id.client;
          if (!lineAuthors.has(currentLine)) {
            lineAuthors.set(currentLine, new Map());
          }
          const clientCounts = lineAuthors.get(currentLine)!;
          clientCounts.set(clientId, (clientCounts.get(clientId) || 0) + 1);
        }
      }
    }
    node = node.right;
  }

  const result = new Map<number, number>();
  lineAuthors.forEach((clientCounts, line) => {
    let maxClient = -1;
    let maxCount = -1;
    clientCounts.forEach((count, clientId) => {
      if (count > maxCount) {
        maxCount = count;
        maxClient = clientId;
      }
    });
    if (maxClient !== -1) {
      result.set(line, maxClient);
    }
  });

  return result;
}

export function useBlameAnnotations({
  workspaceId,
  fileId,
  isBlameOpen = false,
  onBlameToggle,
  editor,
  ydoc,
  awarenessStates,
  authorMap = {},
}: UseBlameAnnotationsOptions) {
  const [showBlame, setShowBlame] = useState(isBlameOpen);
  const [blameData, setBlameData] = useState<Map<number, number>>(new Map());
  const [lineCount, setLineCount] = useState(1);
  const [historicalAuthorMap, setHistoricalAuthorMap] = useState<Record<string, { userId?: string; username: string; color: string }>>({});
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowBlame(isBlameOpen);
  }, [isBlameOpen]);

  const toggleBlame = useCallback(() => {
    setShowBlame((prev) => {
      const next = !prev;
      onBlameToggle?.(next);
      return next;
    });
  }, [onBlameToggle]);

  useEffect(() => {
    if (!showBlame || !workspaceId || !fileId) return;

    let isMounted = true;
    const token = getNexusToken();
    fetchFileHistory(token, workspaceId, fileId)
      .then((data) => {
        if (isMounted && data.authorMap) {
          setHistoricalAuthorMap(data.authorMap);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [showBlame, workspaceId, fileId]);

  const liveAuthorMap = useMemo(() => {
    const map: Record<string, { userId?: string; username: string; color: string }> = {};
    awarenessStates.forEach(([clientId, state]) => {
      if (state.user) {
        map[String(clientId)] = {
          userId: state.user.id,
          username: state.user.name,
          color: state.user.color,
        };
      }
    });
    return { ...authorMap, ...historicalAuthorMap, ...map };
  }, [awarenessStates, authorMap, historicalAuthorMap]);

  useEffect(() => {
    if (!showBlame || !editor || !ydoc) return;

    const updateBlame = () => {
      const ytext = ydoc.getText('monaco');
      setBlameData(getChronologicalLineBlame(ytext));
      setLineCount(editor.getModel()?.getLineCount() || 1);
    };

    updateBlame();
    const disposable = editor.onDidChangeModelContent(updateBlame);
    return () => disposable.dispose();
  }, [showBlame, editor, ydoc]);

  return {
    showBlame,
    setShowBlame,
    toggleBlame,
    blameData,
    lineCount,
    setLineCount,
    liveAuthorMap,
    sidebarRef,
  };
}
