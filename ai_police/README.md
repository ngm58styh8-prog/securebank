# AI Police

AI police pull speeding drivers over and write a citation. They also answer shots, explosions, killings, and heists when no police player is in the city. If an officer is online, that player gets the call and the AI stays off the crime.

Fines come out of the bank first, then cash. What the player cannot pay stays on the character until `/citations`. Amounts are in dollars.

## Install

The folder you drop in `resources` must be named `ai_police`, and `fxmanifest.lua` has to sit directly inside it. Then add this line to `server.cfg`:

```cfg
ensure ai_police
```

It starts on a plain test server. The console should print `AI Police 1.1.3 started`. If the console instead says `Could not find dependency ox_lib`, the server is still running an older folder. Delete that folder and extract this one. On a plain test server each player has a test wallet of $50,000 in the bank. On Qbox or QBCore, put the ensure line after `ox_lib` and `qbx_core` (or `qb-core`) so the fine comes out of the character instead.

Restart the server, or `ensure ai_police` from the console before players are in a chase. Do not restart it while a unit is already spawned on someone.

## What players do

- Hold more than 12 km/h over the limit (80 km/h by default) for 5 seconds. One police cruiser comes from the road behind you. The script does not brake your car. Pull over for the speeding citation. Drive off and they chase.
- A chase stays on you while an officer can see you. Inside 25 m the lead car rams. You lose them only after 30 seconds out of sight. At 60 seconds a SWAT van with 4 officers joins.
- A robbery raises it to at least 2 stars, a kill to 3, and a heist to 4. More stars send more police cars, up to 4. Call the export with `offense = 'robbery'` or `offense = 'heist'`.
- Robbery and homicide do not write a citation and do not take a fine. A catch is 3 minutes in the Mission Row cell, even if the suspect drops the weapon.
- Drive off after a speeding warning and the charge becomes eluding if they catch you. If you stay out of sight for 30 seconds, that stop ends with no citation.
- Shoot, blow an explosive, or kill another player while no police character is online and a unit responds. For other crimes, drop the weapon and stand still to take the fine without the cell. Fight, and they shoot back.
- `/citations` shows the record and pays a fine. The same desk ped stands outside vanilla Mission Row.

On-duty police and EMS are not ticketed. Off-duty ones can be, because they are in their own car.

## If your police job is not named `police`

Open `config.lua` and add the job name to `Config.PoliceJobs` and `Config.ExemptJobs`. A job whose type is `leo` already counts, which is the usual Qbox setup.

`/aipolice` (admin) prints how many police players the script can see. If that number stays at 0 while officers are in the city, the job name is missing from the config, and the AI will keep answering crime.

## Heists

Gunfire at a heist already pages this script. A silent heist (hack, thermite, no shots) needs one server-side line where the robbery starts:

```lua
exports['ai_police']:Dispatch({
    coords = coords,
    offense = 'heist',
    severity = 3,
    title = 'Mountain heist',
    code = '10-90',
    suspect = source,
})
```

`offense` must be one of `heist`, `robbery`, `shots_fired`, `explosion`, `homicide`, or `civilian_assault`. A kill, a robbery, or a heist is what raises the star count.

If officers are online, this does not spawn AI. It notifies the on-duty officers and gives them a short map blip. The same export is safe to call either way.

You can also add the heist's existing server event to `Config.HookEvents` if that event's first argument is a `vector3` or a table with `coords`.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/citations` | Everyone | View and pay fines |
| `/aipolice` | Admin | Police count and active AI calls |
| `/aiptest traffic` | Admin | Cruiser pulls you over and writes a real ticket |
| `/aiptest crime` | Admin | Crime unit responds even if officers are online |
| `/aipclear` | Admin | Wipe your own fines and release a detain |

Admin means the `group.admin`, `admin`, or `command` ace, or a Qbox admin permission.

## Tune it

All of the knobs are in `config.lua`: speed limit, fines, cell time, weapons, how many cars spawn, and the Mission Row cell. Move `Config.HoldingCell`, `Config.ReleaseCoords`, and `Config.Clerk` if your police station is not the vanilla one. Set `Config.Clerk.Enabled = false` if you only want `/citations`.

`Config.RequireDuty = false` matches "no police in the server": one connected police character is enough to stop AI crime response, even off duty. Set it to `true` if off-duty should not count.

## Notes

Fines are stored on the character metadata (`aipfines`). There is no SQL. The client asks for a unit, and the server decides the amount, so a modified amount in a menu does not change the charge.
