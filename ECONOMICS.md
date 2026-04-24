# Neon Slither: Economic System Architecture

This document describes the financial and economic mechanics powering the **Neon Slither** game environment. Future developers and AI assistants should use this as a reference point for understanding how value flows between the player, the ecosystem bots, and the house.

## 1. System Currency & Injecting Funds
The platform operates on a virtual balance system (System Credits), denominated in USD (`$`). 
Players can "Inject Funds" to artificially increase their balance in $5 increments. The application explicitly tracks the `totalInjected`, `totalSessions` played, and calculates a floating Gross P/L for the operator (the player playing the game).

## 2. Session Buy-in
Every single round of Slither operates as an arcade-style wager. 
* **Cost:** It costs exactly **$0.01** to launch a session. 
* **Execution:** When the user clicks "Launch Session", $0.01 is immediately deducted from their `balance`. If their balance drops below $0.01, they are locked out of the game until they inject more funds.

## 3. Entity Valuation
Every snake in the arena (including the 25 AI-controlled bots) acts as a walking wallet.
* **Base Value:** Every single snake on the map is intrinsically backed by a base value of **$5.00**. This models a universe where every snake "bought in" for $5.00.
* **Accumulated Value (`collectedMoney`):** As snakes (player or bots) traverse the map and consume valuable food, their internal wallet grows. 

## 4. Death & Loot Drops (The Rake System)
When a snake crashes into a wall or another snake's body, it dies and its "wealth" is violently converted into physical drops on the floor. However, the conversion process heavily favors the house.

### The Math of a Snake Death:
When a snake is killed, the drop value is calculated as follows:
1. **Value Calculation:** `Total Value = Base $5.00 + (50% of the dead snake's collectedMoney)`
2. **The House Rake:** The platform automatically skims a **5% website fee** off the top of this drop. (`totalValue * 0.95`).
3. **Passive Redistribution:** A theoretical 1% of the total house rake funds the map ecosystem. Every standard, tiny little colorful food on the map brings the player **$0.01**. This provides an immediate psychological incentive for fresh players to stay alive and slither around, generating a slow trickle of funds before engaging in high-stakes predatory gameplay against bots or other players.
4. **Distribution:** The post-fee value is divided equally among the physical food orbs the dead snake drops. These massive orbs are distinctly colored `Gold` to visually distinguish them from the $0.01 colorful food.

*Note: The remaining 50% of the dead snake's collected money simply vanishes into the house's void. It is not dropped.*

## 5. Player Earnings & The Death Penalty
* **Instant Payouts:** When a player consumes a Gold orb, its monetary value is **instantaneously credited** to their live wallet balance (via the `onMoneyCollect` callback). There is no "cashout" button required to secure these partial earnings.
* **The Death Penalty:** However, since the player's internal `collectedMoney` state is mirrored into their wallet, dying carries a severe penalty. When the *player* dies, the game executes a clawback: it forcibly deducts **50% of your current session's earnings** directly from your global wallet. 

## 6. Dash Mechanics
* **Dashing Cost:** Dashing (holding mouse down) slowly burns the snake's structural score/length. 
* **Zero Value Drops:** The segments dropped by a snake while dashing do *not* carry any monetary value (`moneyValue = 0`). They only grant score/length points. Financial transfers strictly only happen upon a fatal collision.

## Summary of House Edges
1. **The Rake:** 3% taken off every total loot drop.
2. **The 50% Void:** 50% of a dead snake's accumulated wealth is permanently deleted from the economy upon death.
3. **The Player Penalty:** If a player earns $100 but gets sloppy and dies, they are instantly taxed $50 out of their account.

By manipulating the `moneyValue` fields directly inside `src/components/Game.tsx`, the RTP (Return to Player) of the Slither economy can be tightened or loosened.
