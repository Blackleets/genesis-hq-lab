from __future__ import annotations
import csv
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
SCRIPT = ROOT / 'research' / 'fx-tsmom' / 'forex_trend_system.py'
OUT = ROOT / 'research-output'
DATA = OUT / 'data'
REPORTS = OUT / 'reports'
RAW = OUT / 'terminal_raw.log'
MANIFEST = OUT / 'download_manifest.json'
REPORTS.mkdir(parents=True, exist_ok=True)

LOOKBACKS = [126, 189, 252, 378]
REBALANCES = [10, 21, 63]
BASELINE = (252, 21)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def emit(text: str, *, err: bool = False) -> None:
    stream = sys.stderr if err else sys.stdout
    print(text, file=stream, flush=True)
    with RAW.open('a', encoding='utf-8') as f:
        f.write(text + '\n')


def run_cmd(cmd: list[str]) -> tuple[int, str]:
    emit('RAW_COMMAND ' + json.dumps(cmd))
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    lines: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip('\n')
        lines.append(line)
        emit(line)
    rc = proc.wait()
    emit(f'RAW_EXIT_CODE {rc}')
    return rc, '\n'.join(lines)


def safe_report_path(pair: str) -> Path:
    return DATA / f'{pair}.report.json'


def copy_report(pair: str, label: str) -> dict:
    src = safe_report_path(pair)
    if not src.exists():
        raise FileNotFoundError(f'report_missing:{src}')
    dest = REPORTS / f'{label}.json'
    shutil.copy2(src, dest)
    return json.loads(dest.read_text(encoding='utf-8'))


def flatten(pair: str, ticker: str, phase: str, lb: int, rb: int, report: dict) -> dict:
    train = report['train']; test = report['test']; tc = report['temporal_consistency']; mc = report.get('monte_carlo_oos') or {}
    return {
        'pair': pair,
        'ticker': ticker,
        'phase': phase,
        'lookback_days': lb,
        'rebalance_days': rb,
        'period_start': report['period']['start'],
        'period_end': report['period']['end'],
        'n_days': report['period']['n_days'],
        'train_n': train['n_trades'],
        'train_win_rate': train['win_rate'],
        'train_pf': train['profit_factor'],
        'train_expectancy_pct': train['expectancy_pct'],
        'train_tstat': train['tstat'],
        'train_max_dd_pct': train['max_dd_pct'],
        'train_verdict': train['verdict'],
        'test_n': test['n_trades'],
        'test_win_rate': test['win_rate'],
        'test_pf': test['profit_factor'],
        'test_expectancy_pct': test['expectancy_pct'],
        'test_tstat': test['tstat'],
        'test_max_dd_pct': test['max_dd_pct'],
        'test_verdict': test['verdict'],
        'temporal_h1_mean_pct': tc['h1_mean_pct'],
        'temporal_h2_mean_pct': tc['h2_mean_pct'],
        'temporal_consistent': tc['consistent'],
        'mc_p5_total_return_pct': mc.get('p5_total_return_pct'),
        'mc_p50_total_return_pct': mc.get('p50_total_return_pct'),
        'mc_p95_drawdown_pct': mc.get('p95_drawdown_pct'),
        'final_verdict': report['final_verdict'],
    }


def execute(pair: str, ticker: str, lb: int, rb: int, phase: str) -> dict | None:
    csv_path = DATA / f'{pair}.csv'
    cmd = [sys.executable, str(SCRIPT), '--csv', str(csv_path), '--pair', pair, '--lookback', str(lb), '--rebalance', str(rb)]
    if pair == 'USDJPY':
        cmd.append('--jpy-pair')
    rc, _ = run_cmd(cmd)
    if rc != 0:
        emit(f'VALIDATION_FAILED pair={pair} phase={phase} lookback={lb} rebalance={rb} rc={rc}', err=True)
        return None
    label = f'{phase}_{pair}_lb{lb}_rb{rb}'
    report = copy_report(pair, label)
    row = flatten(pair, ticker, phase, lb, rb, report)
    emit('RESULT_JSON ' + json.dumps(row, sort_keys=True))
    return row


RAW.write_text('', encoding='utf-8')
manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
emit(f'EVIDENCE_SCRIPT_SHA256 {sha256(SCRIPT)}')
emit(f'EVIDENCE_MANIFEST_SHA256 {sha256(MANIFEST)}')
emit('EVIDENCE_GATES_UNCHANGED min_trades=50 min_win_rate=0.40 min_profit_factor=1.30 min_expectancy_pct=0.05 min_tstat=2.0 max_drawdown_pct=25.0')

available = [x for x in manifest['instruments'] if x['status'] == 'OK']
failed = [x for x in manifest['instruments'] if x['status'] != 'OK']
emit('EVIDENCE_AVAILABLE ' + json.dumps(available, sort_keys=True))
emit('EVIDENCE_DOWNLOAD_FAILURES ' + json.dumps(failed, sort_keys=True))

baseline_rows: list[dict] = []
all_rows: list[dict] = []
for inst in available:
    row = execute(inst['pair'], inst['ticker'], *BASELINE, phase='baseline')
    if row:
        baseline_rows.append(row); all_rows.append(row)

baseline_go = [r for r in baseline_rows if r['final_verdict'] == 'GO']
run_sweep = bool(baseline_rows) and not baseline_go
emit(f'BASELINE_GO_COUNT {len(baseline_go)}')
emit(f'SWEEP_REQUIRED {str(run_sweep).lower()}')

if run_sweep:
    for inst in available:
        for lb in LOOKBACKS:
            for rb in REBALANCES:
                if (lb, rb) == BASELINE:
                    baseline = next((r for r in baseline_rows if r['pair'] == inst['pair']), None)
                    if baseline:
                        duplicate = dict(baseline)
                        duplicate['phase'] = 'sweep'
                        all_rows.append(duplicate)
                        emit('SWEEP_REUSE_BASELINE ' + json.dumps({'pair': inst['pair'], 'lookback': lb, 'rebalance': rb}))
                    continue
                row = execute(inst['pair'], inst['ticker'], lb, rb, phase='sweep')
                if row:
                    all_rows.append(row)

fieldnames = list(all_rows[0].keys()) if all_rows else []
if fieldnames:
    with (OUT / 'results.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader(); writer.writerows(all_rows)
(OUT / 'results.json').write_text(json.dumps(all_rows, indent=2), encoding='utf-8')

sweep_rows = [r for r in all_rows if r['phase'] == 'sweep']
sweep_go = [r for r in sweep_rows if r['final_verdict'] == 'GO']
summary = {
    'script_sha256': sha256(SCRIPT),
    'manifest_sha256': sha256(MANIFEST),
    'data_source': manifest['source'],
    'baseline': baseline_rows,
    'baseline_go_count': len(baseline_go),
    'sweep_ran': run_sweep,
    'sweep_combinations_requested_per_pair': len(LOOKBACKS) * len(REBALANCES),
    'sweep_go_count': len(sweep_go),
    'sweep_go_candidates': sweep_go,
    'download_failures': failed,
    'honesty_note': 'Sweep GO candidates are parameter-discovery candidates, not untouched OOS proof, because the same TEST partition is inspected repeatedly. They require a fresh holdout/forward paper validation before any edge claim.',
}
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
emit('FINAL_SUMMARY ' + json.dumps(summary, sort_keys=True))
