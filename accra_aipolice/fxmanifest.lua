fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'accra_aipolice'
author 'AI Police'
description 'AI police for traffic tickets, citations, and crime response when no officers are online'
version '1.1.3'

shared_scripts {
    'shared/boot.lua',
    'config.lua',
    'shared/util.lua',
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/app.js',
}

client_scripts {
    'client/main.lua',
    'client/citations.lua',
    'client/traffic.lua',
    'client/crime.lua',
}

server_scripts {
    'server/main.lua',
}

-- 1.1.3: no citation for robbery or homicide (3 minute jail), real pursuit, SWAT at 60 seconds.
