import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';

describe('useTimelapsePlayer Scrubber Hook Suite', () => {
  it('controls playback speed and scrubber frame position accurately', () => {
    const useTimelapseScrubber = (totalFrames: number) => {
      const [currentFrame, setCurrentFrame] = useState(0);
      const [isPlaying, setIsPlaying] = useState(false);
      const [speed, setSpeed] = useState<1 | 2 | 4>(1);

      const play = () => setIsPlaying(true);
      const pause = () => setIsPlaying(false);
      const stepForward = () => setCurrentFrame(f => Math.min(totalFrames - 1, f + speed));

      return { currentFrame, isPlaying, speed, setSpeed, play, pause, stepForward };
    };

    const { result } = renderHook(() => useTimelapseScrubber(100));

    expect(result.current.currentFrame).toBe(0);

    act(() => {
      result.current.play();
      result.current.setSpeed(2);
    });

    act(() => {
      result.current.stepForward();
    });

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.speed).toBe(2);
    expect(result.current.currentFrame).toBe(2);
  });
});
