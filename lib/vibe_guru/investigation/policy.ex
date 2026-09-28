defmodule VibeGuru.Investigation.Policy do
  @moduledoc """
  Decides what to measure next. The seam a model plugs into later.

  Two implementations are intended, behind this one callback:

    * `Policy.Rules` — hand-written, free, deterministic. Handles the obvious majority.
    * `Policy.Jev` — a decision model, for the nodes the rules genuinely cannot settle.

  The rules come first, and not because a model could not handle the easy nodes. Writing
  them is how you find out **which nodes are actually hard**, and those are the only ones
  worth paying a call for. The detector taught this already: nearly everything that looked
  like judgment turned out to be a file read.

  ## What a policy may and may not do

  A policy chooses **what to measure**. It never decides **what a measurement means** —
  that stays with the analyzers, deterministic and reproducible, which is what lets the
  same evidence be re-analyzed for free and the same run produce the same findings twice.

  ## Reproducibility

  A model choosing the path means two runs of one repo can diverge — fine for an
  interactive report, fatal for a CI gate meant to block a merge. So the interactive path
  consults a policy live and the CI path replays a pinned one. Recording each decision
  against the state that produced it is what makes that possible, whichever policy ran.
  """

  alias VibeGuru.Investigation.State

  @typedoc """
  Where a probe should point. `:route` is the usual focus; `:constructor_hint` lets a
  cheap earlier probe pass on what it learned, so an expensive one can look in the right
  place instead of scanning everything.
  """
  @type focus :: %{optional(:route) => String.t(), optional(:constructor_hint) => String.t()}

  @typedoc """
  What a cause has to carry to be worth reporting: what is wrong, where, the fix, and
  which findings it accounts for. `explains` is the payoff — three findings collapsing
  into one cause with one fix.
  """
  @type cause :: %{
          id: atom(),
          what: String.t(),
          where: String.t(),
          fix: String.t(),
          explains: [String.t()]
        }

  @type decision ::
          {:probe, String.t(), focus()}
          | {:conclude, cause()}
          | {:abandon, :exhausted | :budget | :stalled}

  @doc "Stable identifier, e.g. `:rules`."
  @callback id() :: atom()

  @doc "Choose the next step for one symptom under investigation."
  @callback next_step(State.t()) :: decision()
end
