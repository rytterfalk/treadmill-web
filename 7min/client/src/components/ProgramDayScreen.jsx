import { useEffect, useMemo, useState } from 'react';

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Något gick fel');
  return data;
}

function ProgramDayScreen({ programDayId }) {
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [todayData, setTodayData] = useState(null);
  const [actuals, setActuals] = useState({});
  const [saving, setSaving] = useState(false);
  const [testMax, setTestMax] = useState(0);

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    html.classList.add('workout-lock');
    body.classList.add('workout-lock');

    const prev = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
    };

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.height = '100%';
    html.style.height = '100%';

    return () => {
      html.classList.remove('workout-lock');
      body.classList.remove('workout-lock');

      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      body.style.width = prev.bodyWidth;
      body.style.height = prev.bodyHeight;
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;

      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api('/api/today');
        if (cancelled) return;
        if (data.kind !== 'program_day' || data.program_day?.id !== programDayId) {
          setStatus('error');
          setError('Kunde inte hitta programdagen (öppna via START-kortet)');
          return;
        }
        setTodayData(data);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [programDayId]);

  const plan = todayData?.program_day?.plan || null;
  const program = todayData?.program || null;
  const dayType = todayData?.program_day?.day_type || null;

  const entries = useMemo(() => {
    if (!plan) return [];
    if (plan.method === 'submax') {
      return (plan.sets || []).map((s, idx) => ({
        key: `set_${idx}`,
        label: `Set ${idx + 1}`,
        target: Number(s.target_reps) || 0,
      }));
    }
    if (plan.method === 'ladder') {
      const steps = plan.ladders?.[0]?.steps || [];
      return steps.map((n, idx) => ({
        key: `step_${idx}`,
        label: `Steg ${idx + 1}`,
        target: Number(n) || 0,
      }));
    }
    return [];
  }, [plan]);

  useEffect(() => {
    if (!entries.length) return;
    setActuals((prev) => {
      const next = { ...prev };
      entries.forEach((e) => {
        if (next[e.key] == null) next[e.key] = e.target;
      });
      return next;
    });
  }, [entries]);

  useEffect(() => {
    if (dayType !== 'test') return;
    const baseline = Number(program?.test_max) || 0;
    setTestMax((prev) => (prev ? prev : baseline || 1));
  }, [dayType, program]);

  async function handleComplete() {
    if (!plan) return;
    setSaving(true);
    try {
      let result_json;
      if (plan.method === 'submax') {
        result_json = {
          sets: entries.map((e) => ({
            target_reps: e.target,
            actual_reps: Number(actuals[e.key]) || 0,
          })),
        };
      } else if (plan.method === 'ladder') {
        result_json = {
          steps: entries.map((e) => Number(actuals[e.key]) || 0),
        };
      } else {
        throw new Error('Okänd plan');
      }

      await api(`/api/program-days/${programDayId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ result_json }),
      });

      window.location.href = '/';
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSave() {
    setSaving(true);
    setError('');
    try {
      const n = Number(testMax);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error('Max måste vara ett heltal >= 1');
      }
      await api(`/api/program-days/${programDayId}/test`, {
        method: 'POST',
        body: JSON.stringify({ test_max: Math.round(n) }),
      });
      window.location.href = '/';
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const WORKOUT_CSS = `.workout-screen{position:fixed;inset:0;z-index:2147483647;background:linear-gradient(180deg,#1a1a1a 0%,#252525 50%,#1a1a1a 100%);display:flex;flex-direction:column;width:100vw;width:100dvw;height:100vh;height:100dvh;overflow:hidden;color:#fff}
.workout-header{display:flex;justify-content:space-between;gap:12px;padding:12px 16px 8px;padding-top:max(12px,env(safe-area-inset-top,0px))}
.workout-content{flex:1 1 auto;min-height:0;overflow:auto;padding:0 16px 16px;padding-bottom:max(16px,env(safe-area-inset-bottom,0px))}
.workout-card{background:rgba(37,37,37,.9);border:1px solid #3a3a3a;border-radius:16px;padding:14px}
.workout-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.workout-row:last-child{border-bottom:none}
.workout-row input{width:84px}
.muted{color:#b0b0b0}
.actions{display:flex;gap:10px;margin-top:16px}
.actions button{flex:1;min-height:48px}
.ghost{background:rgba(51,51,51,.9);border:1px solid #3a3a3a;color:#fff}
.primary{background:linear-gradient(135deg,#f7c72b 0%,#f59e0b 100%);border:none;color:#1a1a1a;font-weight:700}
`;

  if (status === 'loading') {
    return (
      <>
        <style>{WORKOUT_CSS}</style>
        <div className="workout-screen">
          <div className="workout-header">
            <div>
              <p className="muted">Laddar</p>
              <h2>Program day</h2>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (status === 'error') {
    return (
      <>
        <style>{WORKOUT_CSS}</style>
        <div className="workout-screen">
          <div className="workout-header">
            <div>
              <p className="muted">Hoppsan</p>
              <h2>{error || 'Något gick fel'}</h2>
            </div>
            <button className="ghost" onClick={() => (window.location.href = '/')}>
              Tillbaka
            </button>
          </div>
          <div className="workout-content">
            {error ? <p className="muted">{error}</p> : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{WORKOUT_CSS}</style>
      <div className="workout-screen" role="application">
        <div className="workout-header">
          <div>
            <p className="muted">Progressivt program</p>
            <h2>
              {program?.exercise_key || 'Övning'} • {plan?.method || 'plan'}
            </h2>
            <div className="muted">{todayData?.program_day?.date}</div>
          </div>
          <button className="ghost" onClick={() => (window.location.href = '/')}>
            Avsluta
          </button>
        </div>
        <div className="workout-content">
          {error ? <div className="status">{error}</div> : null}
          {dayType === 'test' ? (
            <>
              <div className="workout-card">
                <div className="workout-row">
                  <div>
                    <div>Max-test (reps)</div>
                    <div className="muted">Spara ditt nya max. Programmet re-basas direkt.</div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={testMax || ''}
                    onChange={(ev) => setTestMax(ev.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="actions">
                <button className="primary" onClick={handleTestSave} disabled={saving}>
                  {saving ? 'Sparar…' : 'Spara test'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="workout-card">
                {entries.map((e) => (
                  <div key={e.key} className="workout-row">
                    <div>
                      <div>{e.label}</div>
                      <div className="muted">Target: {e.target}</div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={actuals[e.key] ?? ''}
                      onChange={(ev) =>
                        setActuals((prev) => ({ ...prev, [e.key]: ev.target.value }))
                      }
                      disabled={saving}
                    />
                  </div>
                ))}
              </div>

              <div className="actions">
                <button
                  className="primary"
                  onClick={handleComplete}
                  disabled={saving || entries.length === 0}
                >
                  {saving ? 'Sparar…' : 'Spara & Klar'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default ProgramDayScreen;
