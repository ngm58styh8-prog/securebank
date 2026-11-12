fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'ai-police'
author 'AI Police'
description 'Qbox AI police: traffic stops, road pursuits, SWAT on long chases'
version '1.0.0'

shared_scripts {
    '@ox_lib/init.lua',
    'config.lua',
}

client_script 'client.lua'
server_script 'server.lua'

dependencies {
    'ox_lib',
    'qbx_core',
}
