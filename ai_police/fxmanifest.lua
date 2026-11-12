fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'ai_police'
author 'AI Police'
description 'AI police for traffic tickets, citations, and crime response when no officers are online'
version '1.1.5'

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

-- 1.1.5 raises the star level when the suspect flees and when SWAT joins.
