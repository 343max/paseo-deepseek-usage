# DeepSeek usage

Shows your DeepSeek balance in Paseo's usage panel, beside Claude, Codex, and the other
built in sources, in a row at the bottom of the sidebar, and measures your spend against
limits you set.

## How the numbers are made

DeepSeek publishes a balance for an API key but no usage history. `GET /user/balance` is
the only account endpoint a key can reach, and the usage console refuses API keys. So the
balance is read from DeepSeek directly, and spend is the difference between consecutive
readings. The plugin reads the balance every ten minutes by default, again whenever the usage
panel refreshes, and again when the settings screen is opened more than a minute after the
last reading. A drop counts as spend and a rise counts as credit that was added, so a top up
is never mistaken for negative spend.

## Setup

The key is read from pi's login store, `~/.pi/agent/auth.json`, at its `deepseek` entry, or
from wherever `PI_CODING_AGENT_DIR` points. If that store has no DeepSeek login, the daemon
environment variable `DEEPSEEK_API_KEY` is used instead. The store is only ever read, never
written, so pi keeps ownership of token rotation.

Readings are kept in `ledger.json` under `$XDG_STATE_HOME/paseo-deepseek-usage/`, or
`~/.local/state/paseo-deepseek-usage/` when that variable is unset. It holds balances,
counters, and timestamps, never the key. Delete it to start over.

Requires Paseo 0.11.2 or later. Everything runs on the daemon machine. The key and the
balances do not leave it, and the plugin makes no other network calls.

## Settings

Open Settings, then Plugins, then DeepSeek usage. The screen opens with your balance, what you
spent today, and what you spent over the last 30 days, then the limits those figures are
measured against. Two commands in the command center, which you reach with Command K on macOS
or Control K elsewhere, open the settings screen and the web usage page. The sidebar footer
shows the balance too, with what today has cost beside it, and pressing it shows the balance
against both limits. The row reads the last reading rather than taking one, so it never spends a
request of its own, and it can be moved or hidden under Settings, then Sidebar.

- Daily limit: spend since local midnight, as a percentage. This is the window that appears in
  the sidebar next to the other providers. It resets at your own midnight, and no reset time is
  shown because that boundary is already on your clock.
- 30 day limit: spend over the last 30 days, today included, shown in the usage panel only. It
  is a rolling window, so it has no reset date; each new day pushes the oldest one out.
- Sample interval: how often the balance is read, five to sixty minutes.

Limits are amounts in your wallet's own currency, which DeepSeek reports as USD or CNY, so the
percentage compares like with like. Both limits are yours and not DeepSeek's. DeepSeek is
prepaid and has no quota of its own, so with no limit there is no percentage to show and
nothing appears in the sidebar. Clearing a field removes that limit and its window.

Spend is measured but not listed in the usage panel: that card shows one figure, your balance.
What you spent is what the limit percentages are calculated from, and the settings screen
spells the amounts out.

## What the numbers can and cannot say

DeepSeek reports two decimals, so progress towards a limit is accurate to a cent. The ledger
begins with the first reading after installation, so usage from before that is not counted.
A change between two readings is booked to the day of the earlier reading, which is the last
day the balance was known; a change that spans midnight therefore lands on yesterday and
today starts clean. While the daemon is not running no readings are taken, so a long gap is
booked to the day before it rather than to the day the daemon returns. Days older than the
rolling window are dropped, so that window cannot reach further back than 30 days however
long the plugin has been installed. The panel states the balance, not the reasons behind it.

The settings screen links to your DeepSeek usage page on the web. It opens a browser and
needs your own signed in session; the plugin itself never reads that page.
