-- Conveyor Works 0.2.0
-- Create-inspired conveyor smoke-test fixture for Jar2Zeus.
-- This is a minimal API integration test, not a port of the Create mod.

local MOD_ID = "conveyorworks"
local DIRECTIONS = { "north", "south", "east", "west" }
local belt_ids = {}

local function log(message)
  if type(mod) == "table" and type(mod.log) == "function" then
    mod.log("[" .. MOD_ID .. "] " .. message)
  end
end

local function register_belts()
  for _, direction in ipairs(DIRECTIONS) do
    local block_id = MOD_ID .. ":belt_" .. direction
    belt_ids[direction] = block_id
    blocks.register(block_id, {
      name = "Conveyor Belt (" .. direction .. ")",
      hardness = 2.0,
      resistance = 3.0,
      tool = "pickaxe",
      sound = "metal",
      tab = "functional_blocks"
    })
  end
end

local function register_components()
  blocks.register(MOD_ID .. ":drive_pulley", {
    name = "Drive Pulley",
    hardness = 2.0,
    resistance = 3.0,
    tool = "pickaxe",
    sound = "metal",
    tab = "functional_blocks"
  })

  blocks.register(MOD_ID .. ":andesite_shaft", {
    name = "Andesite Shaft",
    hardness = 1.5,
    resistance = 2.0,
    tool = "pickaxe",
    sound = "metal",
    tab = "functional_blocks"
  })

  blocks.register(MOD_ID .. ":machine_casing", {
    name = "Machine Casing",
    hardness = 3.0,
    resistance = 6.0,
    tool = "pickaxe",
    sound = "metal",
    tab = "functional_blocks"
  })

  items.register(MOD_ID .. ":belt_wrench", {
    name = "Belt Wrench",
    tab = "tools_and_utilities",
    tooltip = "A test tool for conveyor direction."
  })
end

local function register_recipes()
  recipes.shaped({
    output = MOD_ID .. ":belt_north",
    pattern = { "III", "S S", "III" },
    key = {
      I = "minecraft:iron_ingot",
      S = "minecraft:string"
    }
  })

  recipes.shaped({
    output = MOD_ID .. ":drive_pulley",
    pattern = { " I ", "ISI", " I " },
    key = {
      I = "minecraft:iron_ingot",
      S = "minecraft:stick"
    }
  })

  recipes.shaped({
    output = MOD_ID .. ":andesite_shaft",
    pattern = { "A", "A" },
    key = { A = "minecraft:andesite" }
  })

  recipes.shaped({
    output = MOD_ID .. ":machine_casing",
    pattern = { "III", "I I", "III" },
    key = { I = "minecraft:iron_ingot" }
  })
end

local function move_items()
  if type(world) ~= "table" or type(world.exists) ~= "function" or not world.exists() then
    return
  end
  if type(commands) ~= "table" or type(commands.run) ~= "function" then
    return
  end

  -- Singleplayer command-based prototype. This is intentionally not advertised
  -- as multiplayer-safe; commands.run may be unavailable outside local worlds.
  local commands_by_direction = {
    north = "execute as @e[type=item] at @s if block ~ ~-1 ~ " .. belt_ids.north .. " run tp @s ~ ~ ~-0.08",
    south = "execute as @e[type=item] at @s if block ~ ~-1 ~ " .. belt_ids.south .. " run tp @s ~ ~ ~0.08",
    east  = "execute as @e[type=item] at @s if block ~ ~-1 ~ " .. belt_ids.east  .. " run tp @s ~0.08 ~ ~",
    west  = "execute as @e[type=item] at @s if block ~ ~-1 ~ " .. belt_ids.west  .. " run tp @s ~-0.08 ~ ~"
  }

  for _, direction in ipairs(DIRECTIONS) do
    commands.run(commands_by_direction[direction])
  end
end

local function register_hud()
  hud.add(function(ctx)
    if type(world) == "table" and type(world.exists) == "function" and world.exists() then
      ctx:text("Conveyor Works 0.2.0", 8, 8, 0xFFFFFF)
      ctx:text("Prototype: item transport test", 8, 20, 0xB0B0B0)
    end
  end)
end

local function initialize()
  register_belts()
  register_components()
  register_recipes()
  register_hud()
  timer.every(0.25, move_items)
  log("registered 4 belts, 3 components, 1 tool, and 4 recipes")
end

initialize()
