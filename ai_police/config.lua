Config = {}

-- AI police.
-- Traffic stops run whether or not human officers are on the city.
-- Shots, explosions, player kills, and heist alerts spawn AI units only
-- when nobody with a police job is online. If an officer is online, that
-- player gets the map alert and no AI unit is spawned.
--
-- Drop this folder in your resources, then add to server.cfg:
--   ensure ai_police
-- On Qbox, start it after ox_lib and qbx_core so fines use the character.

Config.Debug = false

Config.Department = 'AI Police'
Config.Currency = '$'

-- Any connected player with one of these jobs, or with job.type = 'leo',
-- counts as "police are in the server" and blocks AI crime response.
-- Set RequireDuty = true if an off-duty officer should not block the AI.
Config.RequireDuty = false

Config.PoliceJobs = {
    police = true,
    sheriff = true,
    lspd = true,
    bcso = true,
    sasp = true,
    sahp = true,
    leo = true,
}

-- On-duty players with these jobs, or job.type leo/ems, are not pulled over
-- and their weapons do not raise a crime call. Off-duty ones can still be
-- ticketed because ExemptRequiresDuty is true.
Config.ExemptRequiresDuty = true

Config.ExemptJobs = {
    police = true,
    sheriff = true,
    lspd = true,
    bcso = true,
    sasp = true,
    sahp = true,
    leo = true,
    ambulance = true,
    doctor = true,
    ems = true,
}

-- How many AI calls can be on the street at once.
Config.MaxCalls = 4

-- Surrendering (stopped, unarmed, or hands up) multiplies cell time.
-- 0 means a player who complies pays the fine and is not detained.
-- Robbery and homicide ignore this and always jail for 3 minutes.
Config.ComplyDetainScale = 0.0

-- These charges never write a citation and never take money.
Config.NoCitation = {
    robbery = true,
    homicide = true,
}

-- A chase is a road pursuit. The script does not brake the player's car.
-- SWAT joins once the chase has stayed in sight for SwatAfterSeconds.
Config.Pursuit = {
    ForceStop = false,
    PitDistance = 25.0,
    LoseSightSeconds = 30,
    SwatAfterSeconds = 60,
}

Config.Swat = {
    ped = 's_m_y_swat_01',
    vehicle = 'riot',
    passengers = 3,
    weapon = 'WEAPON_CARBINERIFLE',
    accuracy = 55,
}

Config.Officers = {
    'K. Mensah',
    'A. Boateng',
    'E. Owusu',
    'S. Asante',
    'M. Darko',
    'F. Agyeman',
    'Y. Adjei',
    'R. Quaye',
    'N. Appiah',
    'L. Tetteh',
}

-- Vanilla GTA police officers and marked police cars only.
Config.Units = {
    { ped = 's_m_y_cop_01', vehicle = 'police' },
    { ped = 's_f_y_cop_01', vehicle = 'police' },
    { ped = 's_m_y_cop_01', vehicle = 'police2' },
    { ped = 's_f_y_cop_01', vehicle = 'police3' },
}

-- How far out, in driving time, the first cruiser spawns. It does not stop the player's car.
Config.ResponseSeconds = 10

-- One star is a single officer and a citation.
-- A kill, a robbery, or a heist raises the stars, and more cars respond.
Config.Stars = {
    Max = 5,
    MaxUnits = 4,
    Gain = {
        shots_fired = 1,
        civilian_assault = 1,
        robbery = 1,
        explosion = 1,
        homicide = 2,
        heist = 2,
        assault_officer = 2,
    },
    Floor = {
        shots_fired = 2,
        civilian_assault = 2,
        robbery = 2,
        explosion = 3,
        homicide = 3,
        heist = 4,
        assault_officer = 3,
    },
}

-- Rushed driving. Emergency vehicles ignore lights and traffic.
Config.DrivingStyle = 786468

Config.Traffic = {
    Enabled = true,
    -- City limit in km/h. A stop starts after they hold Grace over this limit.
    SpeedLimit = 80,
    Grace = 12,
    OverspeedTime = 5000,
    -- Peak speed at or above limit * this ratio is "excessive speed".
    ExcessiveRatio = 1.35,
    StopSpeed = 8,
    EludeSpeed = 30,
    EludeTime = 18000,
    MaxChase = 180000,
    Cooldown = 180,
    -- Set true to stop writing traffic tickets while a police player is online.
    PauseWhenPoliceOnline = false,
}

-- Optional areas with their own limit. First match wins.
-- Speed is still in km/h.
Config.SpeedZones = {
    -- { coords = vector3(-1034.6, -2733.6, 20.2), radius = 450.0, limit = 140 },
}

Config.Crime = {
    Enabled = true,
    DetectGunfire = true,
    DetectExplosions = true,
    DetectPlayerDeath = true,
    -- Off by default so mission NPCs and hunting do not page the police.
    DetectNpcMurder = false,
    Passengers = true,
    Backup = true,
    Accuracy = 30,
    Weapon = 'WEAPON_COMBATPISTOL',
    Cooldown = 180,
    -- How close the suspect must be to the scene for their client to host the cars.
    HostDistance = 250.0,
    UnitsBySeverity = { 1, 1, 2 },
    IgnoredWeapons = {
        'WEAPON_STUNGUN',
        'WEAPON_FLARE',
        'WEAPON_FLAREGUN',
        'WEAPON_FIREEXTINGUISHER',
        'WEAPON_PETROLCAN',
        'WEAPON_HAZARDCAN',
        'WEAPON_SNOWBALL',
        'WEAPON_BALL',
        'WEAPON_SMOKEGRENADE',
        'WEAPON_UNARMED',
    },
}

-- Real officers get a blip and a notification when a call comes in and the
-- AI stays home. They do not get a second copy of ps-dispatch from this script.
Config.NotifyRealPolice = true
Config.PoliceAlertSeconds = 90

-- Areas where gunfire is ignored (gun range, paintball, a shooting gallery).
Config.IgnoreZones = {
    -- { coords = vector3(13.0, -1097.0, 29.8), radius = 25.0 },
}

-- Vanilla Mission Row. Move these if your police station interior is custom.
-- Players who comply are not sent here. Eluding and fighting are.
Config.HoldingCell = vector4(461.05, -994.31, 24.91, 90.0)
Config.ReleaseCoords = vector4(441.13, -981.93, 30.69, 90.0)

-- Sidewalk outside Mission Row. /citations works from anywhere if this ped
-- is standing in the wrong place for your map; set Enabled = false to hide it.
Config.Clerk = {
    Enabled = true,
    model = 's_m_y_cop_01',
    coords = vector4(441.39, -981.76, 30.69, 85.0),
    Blip = true,
}

-- Heist and robbery scripts can fire one of these FROM THE SERVER.
-- The first argument must be a vector3 or a table with coords / x,y,z.
-- For anything else, call the export instead (see README).
Config.HookEvents = {
    -- 'rm_mountainheist:server:policeAlert',
}

-- kinds: which encounter is allowed to write this charge.
-- upgrade: only after a chase or a fight, never the opening call.
-- extra: added on top of the main charge (client may request reckless).
-- server: added by the server (no licence). The client cannot pick it.
Config.Offenses = {
    {
        id = 'speeding',
        label = 'Speeding',
        code = 'AIP-12',
        amount = 1500,
        detain = 0,
        kinds = { traffic = true },
    },
    {
        id = 'excessive_speed',
        label = 'Excessive speed',
        code = 'AIP-13',
        amount = 4000,
        detain = 0,
        kinds = { traffic = true },
    },
    {
        id = 'reckless_driving',
        label = 'Reckless driving',
        code = 'AIP-14',
        amount = 3500,
        detain = 0,
        kinds = { traffic = true },
        extra = true,
    },
    {
        id = 'no_license',
        label = 'No driving licence',
        code = 'AIP-15',
        amount = 2500,
        detain = 0,
        kinds = { traffic = true },
        server = true,
    },
    {
        id = 'eluding',
        label = 'Eluding police',
        code = 'AIP-21',
        amount = 10000,
        detain = 90,
        kinds = { traffic = true },
        upgrade = true,
    },
    {
        id = 'assault_officer',
        label = 'Assault on an officer',
        code = 'AIP-22',
        amount = 15000,
        detain = 150,
        kinds = { traffic = true, crime = true },
        upgrade = true,
    },
    {
        id = 'robbery',
        label = 'Robbery',
        code = 'AIP-80',
        amount = 0,
        detain = 180,
        kinds = { crime = true },
    },
    {
        id = 'shots_fired',
        label = 'Discharging a firearm',
        code = 'AIP-31',
        amount = 7500,
        detain = 60,
        kinds = { crime = true },
    },
    {
        id = 'civilian_assault',
        label = 'Assault',
        code = 'AIP-32',
        amount = 4000,
        detain = 45,
        kinds = { crime = true },
    },
    {
        id = 'homicide',
        label = 'Homicide',
        code = 'AIP-33',
        amount = 0,
        detain = 180,
        kinds = { crime = true },
    },
    {
        id = 'explosion',
        label = 'Unlawful explosion',
        code = 'AIP-34',
        amount = 12000,
        detain = 120,
        kinds = { crime = true },
    },
    {
        id = 'heist',
        label = 'Armed robbery in progress',
        code = 'AIP-90',
        amount = 15000,
        detain = 150,
        kinds = { crime = true },
    },
}

Config.OffenseById = {}

for i = 1, #Config.Offenses do
    local offense = Config.Offenses[i]
    Config.OffenseById[offense.id] = offense
end
