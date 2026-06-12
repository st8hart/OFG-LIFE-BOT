// backfill-challenges.js
//
// ONE-TIME SCRIPT — resolves "expired" challenges from the last N days that
// never got tallied into challenge_records (because of the silent-error bug).
//
// Unlike determineChallengeWinners (which only looks at "today"), this script
// figures out, per-challenge, the Central-Time calendar day the challenge was
// CREATED on, and sums each participant's sales for THAT day specifically.
//
// Usage:
//   node backfill-challenges.js          (looks back 2 days, dry run by default)
//   node backfill-challenges.js --apply  (actually writes to challenge_records)
//
// Run from the project root (same folder as database.js / .env).

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { updateChallengeRecord, formatChallengeMoney } = (() => {
  // formatMoney isn't exported from database.js, so define a tiny local copy
  const db = require('./database');
  return {
    updateChallengeRecord: db.updateChallengeRecord,
    formatChallengeMoney: (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }),
  };
})();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const LOOKBACK_DAYS = 2;
const APPLY = process.argv.includes('--apply');

// Given a Date, return the [start, end] of that Central-Time calendar day,
// as real UTC Date objects.
function centralDayBounds(date) {
  const centralFake = new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const offsetMs = date - centralFake;
  const start = new Date(centralFake);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start: new Date(start.getTime() + offsetMs),
    end: new Date(end.getTime() + offsetMs),
  };
}

async function getUserTotalForDay(userId, dayStart, dayEnd) {
  const { data, error } = await supabase
    .from('sales')
    .select('premium')
    .eq('user_id', userId)
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString());
  if (error) {
    console.error(`  ! sales query failed for ${userId}:`, error.message || error);
    return 0;
  }
  return data.reduce((sum, s) => sum + parseFloat(s.premium), 0);
}

(async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  console.log(`Looking for expired challenges created on/after ${cutoff.toISOString()}...`);
  console.log(APPLY ? 'MODE: APPLY (will write to challenge_records)' : 'MODE: DRY RUN (no writes — pass --apply to commit)');
  console.log('');

  const { data: challenges, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('status', 'expired')
    .gte('created_at', cutoff.toISOString());

  if (error) {
    console.error('Failed to fetch challenges:', error.message || error);
    process.exit(1);
  }

  if (!challenges || !challenges.length) {
    console.log('No expired challenges found in that window. Nothing to do.');
    return;
  }

  console.log(`Found ${challenges.length} expired challenge(s) in the last ${LOOKBACK_DAYS} day(s).\n`);

  for (const challenge of challenges) {
    const created = new Date(challenge.created_at);
    const { start, end } = centralDayBounds(created);

    const challengerTotal = await getUserTotalForDay(challenge.challenger_id, start, end);
    const challengeeTotal = await getUserTotalForDay(challenge.challengee_id, start, end);

    console.log(`Challenge #${challenge.id} (created ${created.toDateString()} Central):`);
    console.log(`  ${challenge.challenger_name} (${challenge.challenger_id}): ${formatChallengeMoney(challengerTotal)}`);
    console.log(`  ${challenge.challengee_name} (${challenge.challengee_id}): ${formatChallengeMoney(challengeeTotal)}`);

    if (challengerTotal === 0 && challengeeTotal === 0) {
      console.log('  -> Skipping: both sides had $0 in sales that day.\n');
      continue;
    }

    const tie = challengerTotal === challengeeTotal;
    const winner = challengerTotal >= challengeeTotal
      ? { id: challenge.challenger_id, name: challenge.challenger_name, total: challengerTotal }
      : { id: challenge.challengee_id, name: challenge.challengee_name, total: challengeeTotal };
    const loser = challengerTotal >= challengeeTotal
      ? { id: challenge.challengee_id, name: challenge.challengee_name, total: challengeeTotal }
      : { id: challenge.challenger_id, name: challenge.challenger_name, total: challengerTotal };

    if (tie) {
      console.log('  -> TIE — no win/loss recorded (consistent with normal resolver behavior).\n');
      continue;
    }

    console.log(`  -> Winner: ${winner.name} | Loser: ${loser.name}`);

    if (APPLY) {
      await updateChallengeRecord(winner.id, winner.name, true);
      await updateChallengeRecord(loser.id, loser.name, false);
      console.log('  -> Recorded.\n');
    } else {
      console.log('  -> (dry run, not written)\n');
    }
  }

  console.log('Done.');
  if (!APPLY) {
    console.log('\nThis was a dry run. Review the results above, then re-run with --apply to write them.');
  }
})();
