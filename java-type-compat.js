/* Conservative Java type compatibility runtime for Jar2Zeus.
 * Emits Lua 5.4 metadata/helpers for class relationships and default object records.
 * It does not execute Java constructors or translate arbitrary Java method bodies.
 */
(function(root){
 "use strict";
 const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const SAFE_CLASS=/^[A-Za-z0-9_$/]+$/;
 function quote(s){
  return '"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r/g,"\\r").replace(/\n/g,"\\n").replace(/\t/g,"\\t").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,c=>"\\"+String(c.charCodeAt(0)).padStart(3,"0"))+'"';
 }
 function luaBool(v){return v?"true":"false";}
 function fieldRows(c){
  return (c.fields||[]).filter(f=>f&&typeof f.name==="string"&&typeof f.descriptor==="string"&&f.validDescriptor&&!BLOCKED.test(f.name));
 }
 function methodRows(c){
  return (c.methods||[]).filter(m=>m&&typeof m.name==="string"&&typeof m.descriptor==="string"&&m.validDescriptor&&!BLOCKED.test(m.name));
 }
 function buildLua(classes){
  const lines=[];
  lines.push("-- Jar2Zeus Java type compatibility metadata (static approximation).");
  lines.push("local __j2z_types = {");
  for(const c of classes){
   lines.push("  ["+quote(c.name)+"] = {");
   lines.push("    parent = "+(c.superName&&SAFE_CLASS.test(c.superName)?quote(c.superName):"nil")+",");
   lines.push("    interface = "+luaBool(c.kind==="interface")+",");
   lines.push("    interfaces = {"+(c.interfaces||[]).filter(x=>SAFE_CLASS.test(x)&&!BLOCKED.test(x)).map(quote).join(", ")+"},");
   lines.push("    fields = {");
   for(const f of fieldRows(c)){
    lines.push("      ["+quote(f.name)+"] = {descriptor="+quote(f.descriptor)+", static="+luaBool(f.storage==="static")+", final="+luaBool(!f.mutable)+", public="+luaBool((f.accessFlags&1)!==0)+", private="+luaBool((f.accessFlags&2)!==0)+", protected="+luaBool((f.accessFlags&4)!==0)+"},");
   }
   lines.push("    },");
   lines.push("    methods = {");
   for(const m of [...methodRows(c),...(c.constructors||[]).filter(m=>m&&m.validDescriptor)]){
    if(BLOCKED.test(m.name))continue;
    const key=m.name+m.descriptor;
    lines.push("      ["+quote(key)+"] = {name="+quote(m.name)+", descriptor="+quote(m.descriptor)+", static="+luaBool(!!m.static)+", abstract="+luaBool(!!m.abstract)+", private="+luaBool((m.accessFlags&2)!==0)+", protected="+luaBool((m.accessFlags&4)!==0)+", public="+luaBool((m.accessFlags&1)!==0)+", native="+luaBool(!!m.native)+"},");
   }
   lines.push("    }");
   lines.push("  },");
  }
  lines.push("}");
  lines.push("local __j2z_null = setmetatable({}, {__tostring=function() return 'null' end})");
  lines.push("local __j2z_static_fields = {}");
  lines.push("local function __j2z_is_null(value) return value == nil or value == __j2z_null end");
  lines.push("local function __j2z_default_value(descriptor)");
  lines.push("  local kind = string.sub(descriptor or '', 1, 1)");
  lines.push("  if kind == 'Z' then return false end");
  lines.push("  if kind == 'B' or kind == 'C' or kind == 'S' or kind == 'I' or kind == 'J' or kind == 'F' or kind == 'D' then return 0 end");
  lines.push("  return __j2z_null");
  lines.push("end");
  lines.push("local function __j2z_is_assignable(source, target, seen)");
  lines.push("  if source == target then return true end");
  lines.push("  if type(source) ~= 'string' or type(target) ~= 'string' then return false end");
  lines.push("  seen = seen or {}");
  lines.push("  if seen[source] then return false end");
  lines.push("  seen[source] = true");
  lines.push("  local info = __j2z_types[source]");
  lines.push("  if not info then return false end");
  lines.push("  for _, name in ipairs(info.interfaces or {}) do");
  lines.push("    if name == target or __j2z_is_assignable(name, target, seen) then return true end");
  lines.push("  end");
  lines.push("  if info.parent then return info.parent == target or __j2z_is_assignable(info.parent, target, seen) end");
  lines.push("  return false");
  lines.push("end");
  lines.push("local function __j2z_get_class(value)");
  lines.push("  if __j2z_is_null(value) or type(value) ~= 'table' then return nil end");
  lines.push("  return rawget(value, '__j2z_class')");
  lines.push("end");
  lines.push("local function __j2z_instanceof(value, target)");
  lines.push("  if __j2z_is_null(value) then return false end");
  lines.push("  local class_name = __j2z_get_class(value)");
  lines.push("  return class_name ~= nil and __j2z_is_assignable(class_name, target)");
  lines.push("end");
  lines.push("local function __j2z_checkcast(value, target)");
  lines.push("  if __j2z_is_null(value) then return value end");
  lines.push("  if not __j2z_instanceof(value, target) then error('java.lang.ClassCastException: cannot cast to ' .. tostring(target), 2) end");
  lines.push("  return value");
  lines.push("end");
  lines.push("local function __j2z_convert_primitive(value, from_descriptor, to_descriptor)");
  lines.push("  local numeric = {B=true, C=true, S=true, I=true, J=true, F=true, D=true}");
  lines.push("  if from_descriptor == 'Z' or to_descriptor == 'Z' then");
  lines.push("    if from_descriptor ~= 'Z' or to_descriptor ~= 'Z' or type(value) ~= 'boolean' then error('invalid Java boolean conversion', 2) end");
  lines.push("    return value");
  lines.push("  end");
  lines.push("  if not numeric[from_descriptor] or not numeric[to_descriptor] or type(value) ~= 'number' then error('unsupported Java primitive conversion', 2) end");
  lines.push("  if from_descriptor == 'F' then value = string.unpack('f', string.pack('f', value)) end");
  lines.push("  if to_descriptor == 'B' or to_descriptor == 'C' or to_descriptor == 'S' or to_descriptor == 'I' then");
  lines.push("    local n");
  lines.push("    if from_descriptor == 'F' or from_descriptor == 'D' then");
  lines.push("      if value ~= value then value = 0 end");
  lines.push("      if value > 2147483647 then value = 2147483647 elseif value < -2147483648 then value = -2147483648 end");
  lines.push("      n = math.modf(value)");
  lines.push("    else n = math.tointeger(value); if n == nil then error('invalid Java integral value', 2) end end");
  lines.push("    if to_descriptor == 'B' then n = n % 256; if n >= 128 then n = n - 256 end; return n end");
  lines.push("    if to_descriptor == 'C' then return n % 65536 end");
  lines.push("    if to_descriptor == 'S' then n = n % 65536; if n >= 32768 then n = n - 65536 end; return n end");
  lines.push("    n = n % 4294967296; if n >= 2147483648 then n = n - 4294967296 end; return n");
  lines.push("  end");
  lines.push("  if to_descriptor == 'J' then");
  lines.push("    if from_descriptor == 'F' or from_descriptor == 'D' then");
  lines.push("      if value ~= value then return 0 end");
  lines.push("      if value >= 9223372036854775808 then return math.maxinteger end");
  lines.push("      if value <= -9223372036854775808 then return math.mininteger end");
  lines.push("      value = math.modf(value)");
  lines.push("    end");
  lines.push("    local n = math.tointeger(value); if n == nil then error('Java long is outside the exact Lua integer range', 2) end; return n");
  lines.push("  end");
  lines.push("  if to_descriptor == 'F' then return (string.unpack('f', string.pack('f', value))) end");
  lines.push("  if to_descriptor == 'D' then return value + 0.0 end");
  lines.push("  return value");
  lines.push("end");
  lines.push("local function __j2z_make_field_value(value, descriptor)");
  lines.push("  if string.sub(descriptor, 1, 1) == 'L' or string.sub(descriptor, 1, 1) == '[' then");
  lines.push("    if __j2z_is_null(value) then return __j2z_null end");
  lines.push("    if string.sub(descriptor, 1, 1) == '[' then error('non-null Java array fields are not supported by this compatibility layer', 2) end");
  lines.push("    local target = string.sub(descriptor, 2, -2)");
  lines.push("    if not __j2z_instanceof(value, target) then error('java.lang.IllegalArgumentException: incompatible field value', 2) end");
  lines.push("    return value");
  lines.push("  end");
  lines.push("  return __j2z_convert_primitive(value, descriptor, descriptor)");
  lines.push("end");
  lines.push("local function __j2z_new_object_record(class_name)");
  lines.push("  if not __j2z_types[class_name] then error('unknown Java class: ' .. tostring(class_name), 2) end");
  lines.push("  local object = {__j2z_class=class_name, __j2z_fields={}}");
  lines.push("  local chain, current, seen = {}, class_name, {}");
  lines.push("  while current and not seen[current] do");
  lines.push("    seen[current] = true; local info = __j2z_types[current]; if not info then break end");
  lines.push("    table.insert(chain, current); current = info.parent");
  lines.push("  end");
  lines.push("  for i = #chain, 1, -1 do");
  lines.push("    local owner = chain[i]; local info = __j2z_types[owner]");
  lines.push("    for name, field in pairs(info.fields or {}) do");
  lines.push("      if not field.static then object.__j2z_fields[owner .. '#' .. name] = __j2z_default_value(field.descriptor) end");
  lines.push("    end");
  lines.push("  end");
  lines.push("  return object");
  lines.push("end");
  lines.push("local function __j2z_find_field(owner, name, want_static)");
  lines.push("  local info = __j2z_types[owner]; local field = info and info.fields and info.fields[name]");
  lines.push("  if not field or field.static ~= want_static then error('unknown Java field: ' .. tostring(owner) .. '.' .. tostring(name), 2) end");
  lines.push("  return field");
  lines.push("end");
  lines.push("local function __j2z_get_field(object, owner, name)");
  lines.push("  if __j2z_is_null(object) then error('java.lang.NullPointerException', 2) end");
  lines.push("  __j2z_checkcast(object, owner); local field = __j2z_find_field(owner, name, false)");
  lines.push("  local fields = rawget(object, '__j2z_fields'); if type(fields) ~= 'table' then error('not a Jar2Zeus Java object record', 2) end");
  lines.push("  local key = owner .. '#' .. name; local value = fields[key]");
  lines.push("  if value == nil then value = __j2z_default_value(field.descriptor); fields[key] = value end");
  lines.push("  return value");
  lines.push("end");
  lines.push("local function __j2z_set_field(object, owner, name, value)");
  lines.push("  if __j2z_is_null(object) then error('java.lang.NullPointerException', 2) end");
  lines.push("  __j2z_checkcast(object, owner); local field = __j2z_find_field(owner, name, false)");
  lines.push("  if field.final then error('cannot write a final Java field outside constructor initialization', 2) end");
  lines.push("  local fields = rawget(object, '__j2z_fields'); if type(fields) ~= 'table' then error('not a Jar2Zeus Java object record', 2) end");
  lines.push("  fields[owner .. '#' .. name] = __j2z_make_field_value(value, field.descriptor); return value");
  lines.push("end");
  lines.push("local function __j2z_get_static(owner, name)");
  lines.push("  local field = __j2z_find_field(owner, name, true); local values = __j2z_static_fields[owner]");
  lines.push("  if not values then values = {}; __j2z_static_fields[owner] = values end");
  lines.push("  local value = values[name]; if value == nil then value = __j2z_default_value(field.descriptor); values[name] = value end");
  lines.push("  return value");
  lines.push("end");
  lines.push("local function __j2z_set_static(owner, name, value)");
  lines.push("  local field = __j2z_find_field(owner, name, true)");
  lines.push("  if field.final then error('cannot write a final static Java field outside class initialization', 2) end");
  lines.push("  local values = __j2z_static_fields[owner] or {}; __j2z_static_fields[owner] = values");
  lines.push("  values[name] = __j2z_make_field_value(value, field.descriptor); return value");
  lines.push("end");
  lines.push("local function __j2z_resolve_virtual(class_name, method_name, descriptor)");
  lines.push("  local current, seen = class_name, {}");
  lines.push("  while current and not seen[current] do");
  lines.push("    seen[current] = true; local info = __j2z_types[current]; if not info then break end");
  lines.push("    local method = info.methods and info.methods[method_name .. descriptor]");
  lines.push("    if method and not method.static and not method.private then return {owner=current, method=method} end");
  lines.push("    current = info.parent");
  lines.push("  end");
  lines.push("  return nil");
  lines.push("end");
  lines.push("local __j2z_java_types = {");
  lines.push("  registry=__j2z_types, null=__j2z_null, is_null=__j2z_is_null, is_assignable=__j2z_is_assignable,");
  lines.push("  instanceof=__j2z_instanceof, checkcast=__j2z_checkcast, convert_primitive=__j2z_convert_primitive,");
  lines.push("  new_object_record=__j2z_new_object_record, get_field=__j2z_get_field, set_field=__j2z_set_field,");
  lines.push("  get_static=__j2z_get_static, set_static=__j2z_set_static, resolve_virtual=__j2z_resolve_virtual");
  lines.push("}");
  lines.push("-- Constructors, <clinit>, Java method bodies and Java access-control checks are not executed here.");
  lines.push("-- Objects created above contain JVM-like default field values only.");
  lines.push("");
  return lines.join("\n");
 }
 function convert(classModel){
  const source=classModel&&Array.isArray(classModel.classes)?classModel.classes:[];
  const classes=source.filter(c=>c&&typeof c.name==="string"&&SAFE_CLASS.test(c.name)&&!BLOCKED.test(c.name));
  const classNames=new Set(classes.map(c=>c.name));
  const report={
   schema:"jar2zeus.java-type-compatibility.v1",
   status:classes.length?"partial":"no-java-classes",
   totals:{classesAvailable:source.length,classesRegistered:classes.length,interfaces:0,fields:0,instanceFields:0,staticFields:0,methods:0,constructors:0,knownParents:0,externalParents:0,knownInterfaces:0,externalInterfaces:0,typedParameters:0,objectParameters:0,arrayParameters:0,invalidSignatures:0},
   helpers:["null","is_null","is_assignable","instanceof","checkcast","convert_primitive","new_object_record","get_field","set_field","get_static","set_static","resolve_virtual"],
   limitations:[
    "new_object_record allocates a blank record with JVM default field values; it does not run constructors or class initializers.",
    "resolve_virtual returns method metadata only; generated Java method bodies are not invoked.",
    "Private/protected/package access checks and Java reflection are not enforced.",
    "Interface default-method conflict and most-specific interface method resolution are not implemented.",
    "Static fields start with JVM default values; ConstantValue attributes and Java <clinit> assignments are not applied.",
    "Non-null array object fields and full Java array covariance/runtime checks are unsupported.",
    "External superclass/interface definitions are unknown unless their class files are included.",
    "Java long values are limited to the exact signed integer range supported by the target Lua 5.4 integer implementation.",
    "Generic type erasure, annotations, exceptions, synchronization and JVM verifier semantics are outside this compatibility layer."
   ],
   warnings:[]
  };
  for(const c of classes){
   if(c.kind==="interface")report.totals.interfaces++;
   if(c.superName){if(classNames.has(c.superName))report.totals.knownParents++;else report.totals.externalParents++;}
   for(const i of c.interfaces||[]){if(classNames.has(i))report.totals.knownInterfaces++;else report.totals.externalInterfaces++;}
   for(const f of fieldRows(c)){report.totals.fields++;if(f.storage==="static")report.totals.staticFields++;else report.totals.instanceFields++;}
   for(const m of methodRows(c)){report.totals.methods++;if(m.signature){for(const p of m.signature.arguments){report.totals.typedParameters++;if(p.kind==="object")report.totals.objectParameters++;if(p.kind==="array")report.totals.arrayParameters++;}}else report.totals.invalidSignatures++;}
   for(const m of c.constructors||[]){report.totals.constructors++;if(!m.validDescriptor)report.totals.invalidSignatures++;}
  }
  report.warnings.push("The emitted Lua layer is a compatibility scaffold for metadata-driven adapters, not a JVM implementation.");
  report.warnings.push("Method dispatch resolves metadata; it cannot call translated Java methods unless a separate adapter supplies the implementation.");
  if(report.totals.externalParents||report.totals.externalInterfaces)report.warnings.push("Some type relationships point to class definitions that were not included in the analyzed JAR.");
  if(report.totals.arrayParameters)report.warnings.push("Array descriptors were recognized in signatures, but non-null Java array runtime semantics are not implemented.");
  return {lua:classes.length?buildLua(classes):"",report};
 }
 root.Jar2ZeusJavaTypes={convert};
})(typeof globalThis!=="undefined"?globalThis:this);
