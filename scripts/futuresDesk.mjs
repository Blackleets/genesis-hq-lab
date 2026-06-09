import { getFuturesDeskSnapshot } from '../server/crypto/futuresDesk.mjs';
const SHOULD_RUN = process.argv.includes('--run');

async function main() {
  const payload = await getFuturesDeskSnapshot({ runCycle: SHOULD_RUN });
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error('[futuresDesk] failed:', error);
  process.exit(1);
});
