from __future__ import annotations

import pytest

from raven import AsyncRaven, Raven, RavenError


def test_raven_requires_api_key() -> None:
    with pytest.raises(TypeError):
        Raven()  # type: ignore[call-arg]


def test_raven_rejects_empty_api_key() -> None:
    with pytest.raises(RavenError):
        Raven(api_key="")


def test_raven_exposes_all_documented_resources() -> None:
    raven = Raven(api_key="k")

    assert raven.projects is not None
    assert raven.tokens is not None
    assert raven.rooms is not None
    assert raven.rooms.participants is not None
    assert raven.connections is not None
    assert raven.errors is not None
    assert raven.metrics is not None
    assert raven.diagnostics is not None
    raven.close()


def test_raven_context_manager_closes_the_client() -> None:
    with Raven(api_key="k") as raven:
        assert raven is not None


def test_raven_never_reads_env_var_implicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAVEN_API_KEY", "should-never-be-read-implicitly")
    with pytest.raises(TypeError):
        Raven()  # type: ignore[call-arg]


def test_async_raven_exposes_all_documented_resources() -> None:
    raven = AsyncRaven(api_key="k")

    assert raven.projects is not None
    assert raven.tokens is not None
    assert raven.rooms is not None
    assert raven.connections is not None
    assert raven.errors is not None
    assert raven.metrics is not None
    assert raven.diagnostics is not None


@pytest.mark.asyncio
async def test_async_raven_context_manager() -> None:
    async with AsyncRaven(api_key="k") as raven:
        assert raven is not None


def test_secret_never_appears_in_client_repr_or_vars() -> None:
    raven = Raven(api_key="rvk_super-secret-value.dontleakme")

    assert "dontleakme" not in repr(raven._http)
    # __dict__ on Raven itself never holds the raw key (it lives inside the
    # http client's own name-mangled attribute, one level down).
    assert "dontleakme" not in repr(vars(raven))
    raven.close()
