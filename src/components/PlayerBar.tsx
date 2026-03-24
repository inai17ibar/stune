import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../stores/useStore';

export default function PlayerBar() {
  const { nowPlaying, playNext, playPrev, setNowPlaying } = useStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Keep a stable ref to playNext to avoid re-registering listeners
  const playNextRef = useRef(playNext);
  playNextRef.current = playNext;

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setIsPlaying(false);
      playNextRef.current();
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  // Update source when nowPlaying changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!nowPlaying) {
      audio.pause();
      audio.src = '';
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    const src = `stune-audio://${encodeURIComponent(nowPlaying.filePath)}`;
    audio.src = src;
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [nowPlaying?.filePath]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setNowPlaying(null);
  }, [setNowPlaying]);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
  }, []);

  if (!nowPlaying) return null;

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return '--:--';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="global-player-bar">
      <div className="player-track-info">
        {nowPlaying.coverArt ? (
          <img className="player-cover" src={nowPlaying.coverArt} alt="" />
        ) : (
          <div className="player-cover placeholder">&#9835;</div>
        )}
        <div className="player-meta">
          <span className="player-title">{nowPlaying.title}</span>
          <span className="player-artist">{nowPlaying.artist}</span>
        </div>
      </div>
      <div className="player-controls">
        <button className="btn btn-icon" onClick={playPrev} title="Previous">
          &#9198;
        </button>
        <button className="btn btn-icon play-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? '\u23F8' : '\u25B6'}
        </button>
        <button className="btn btn-icon" onClick={stop} title="Stop">
          &#9632;
        </button>
        <button className="btn btn-icon" onClick={playNext} title="Next">
          &#9197;
        </button>
      </div>
      <div className="player-seek">
        <span className="player-time">{fmt(currentTime)}</span>
        <input
          type="range"
          className="seek-bar"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={seek}
        />
        <span className="player-time">{fmt(duration)}</span>
      </div>
    </div>
  );
}
