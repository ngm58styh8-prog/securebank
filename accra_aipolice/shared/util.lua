AIP = AIP or {}

function AIP.debug(message)
    if not Config.Debug then return end
    print(('[accra_aipolice] %s'):format(message))
end

function AIP.formatMoney(amount)
    local n = math.floor(math.abs(tonumber(amount) or 0))
    local formatted = tostring(n):reverse():gsub('(%d%d%d)', '%1,'):reverse()
    if formatted:sub(1, 1) == ',' then
        formatted = formatted:sub(2)
    end
    return (Config.Currency or '$') .. formatted
end

function AIP.clean(text, limit)
    text = tostring(text or ''):gsub('[%c]', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    limit = limit or 64
    if #text > limit then
        text = text:sub(1, limit)
    end
    return text
end

function AIP.clamp(value, low, high)
    value = tonumber(value) or low
    if value < low then return low end
    if value > high then return high end
    return value
end

function AIP.insideZone(coords, zones)
    if not coords or not zones then return false end
    for i = 1, #zones do
        local zone = zones[i]
        if zone.coords and zone.radius and #(coords - zone.coords) <= zone.radius then
            return true
        end
    end
    return false
end

function AIP.vecFrom(value)
    if type(value) == 'vector3' then return value end
    if type(value) ~= 'table' then return nil end
    local x = tonumber(value.x or value[1])
    local y = tonumber(value.y or value[2])
    local z = tonumber(value.z or value[3])
    if not x or not y or not z then return nil end
    return vector3(x + 0.0, y + 0.0, z + 0.0)
end
