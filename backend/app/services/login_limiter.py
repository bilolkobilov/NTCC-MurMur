"""Brute-force protection for login: too many wrong passwords for one username from one IP → wait.

Kept in process memory (one server process, no Redis — see AGENTS.md). A restart clears it, which is acceptable:
an attacker still gets at most a few guesses per window. The key is (IP, username), so a stranger cannot lock a
doctor out from another network.
"""

import threading
import time
from collections import deque
from functools import lru_cache

from app.config import get_settings

MAX_TRACKED_KEYS = 10_000  # bound memory if someone sprays random usernames


class LoginLimiter:
    def __init__(self, max_failures: int, window_seconds: float):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.clock = time.monotonic  # replaced in tests
        self._failures: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: tuple[str, str], now: float) -> deque[float]:
        failures = self._failures.get(key, deque())
        while failures and now - failures[0] >= self.window_seconds:
            failures.popleft()
        return failures

    def begin_attempt(self, key: tuple[str, str]) -> int | None:
        """Count a login attempt BEFORE the password is checked; return seconds to wait if the key is blocked.

        Counting first (and in one locked step) means parallel requests cannot all slip past the limit; a
        successful login then calls `reset(key)`, so only wrong passwords stay counted.
        """
        with self._lock:
            now = self.clock()
            failures = self._recent(key, now)
            if len(failures) >= self.max_failures:
                return max(1, int(failures[0] + self.window_seconds - now) + 1)
            if len(self._failures) >= MAX_TRACKED_KEYS:
                self._prune(now)
            failures.append(now)
            self._failures[key] = failures
            return None

    def reset(self, key: tuple[str, str] | None = None) -> None:
        with self._lock:
            if key is None:
                self._failures.clear()
            else:
                self._failures.pop(key, None)

    def _prune(self, now: float) -> None:
        for key in [k for k, v in self._failures.items() if not v or now - v[-1] >= self.window_seconds]:
            del self._failures[key]
        if len(self._failures) >= MAX_TRACKED_KEYS:  # still full: drop the oldest half
            oldest = sorted(self._failures, key=lambda k: self._failures[k][-1])
            for key in oldest[: len(oldest) // 2]:
                del self._failures[key]


@lru_cache
def get_login_limiter() -> LoginLimiter:
    settings = get_settings()
    return LoginLimiter(settings.login_max_failures, settings.login_lock_minutes * 60)


def limiter_key(client_ip: str | None, username: str) -> tuple[str, str]:
    return (client_ip or "unknown", username.strip().lower())
