# AI Police

Qbox resource for the AI Police city rules. Every file for the resource is in this one folder. There are no client or server subfolders.

- Speeding above 92 km/h for 5 seconds sends one cruiser. The script does not brake the player car.
- Pulling over opens a speeding citation for GH₵ 1,500, taken from the bank first, then cash. The card signs or closes after 25 seconds. Unpaid money stays on `/citations`.
- Fleeing turns it into a road chase and adds a second cruiser.
- Cruisers spawn on a road node 90–140 m out, run lights and siren, and stay on that vehicle.
- Inside 25 m the lead cruiser rams. A second cruiser blocks. If the suspect bails, officers get out and run them down.
- Stars hold while an officer can see the suspect. They drop only after 30 seconds with no eyes on them.
- A chase still in sight at 60 seconds deploys one SWAT van with 4 officers.
- Robbery and kill have no citation. A catch is 3 minutes in the Mission Row cell.
- A heist fine is GH₵ 15,000 if they drop the weapon and stand still. Fighting and getting caught is 150 seconds.
- Any connected police job, on duty or not, takes the crime call. AI cars and SWAT stay off that call. Speeding stops still happen. On-duty police and EMS are not pulled over.

## Install

1. Unzip `ai-police` into your server `resources` folder.
2. In `server.cfg`, after `ox_lib` and `qbx_core`:

```
ensure ai-police
```

3. From a robbery or a silent heist:

```lua
exports['ai-police']:CallPolice('robbery')
exports['ai-police']:CallPolice('heist')
```

Gunfire inside a zone in `config.lua` already counts as a heist. A player kill is detected by this resource. No extra hook is required.

This resource turns off ambient dispatch cops on the client so its own units run the chase.
