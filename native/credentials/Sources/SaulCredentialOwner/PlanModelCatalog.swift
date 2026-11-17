import CoreFoundation
import Foundation
import SaulNativeValues

/// Normalizes ChatGPT discovery rows before they leave the signed owner.
enum PlanModelCatalog {
  static func model(_ catalog: [String: Any]) -> ConnectionModel? {
    func text(_ value: Any?, max: Int = 256) -> String? {
      guard let value = value as? String,
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        value.utf16.count <= max
      else { return nil }
      return value
    }
    guard catalog["visibility"] as? String == "list", let slug = text(catalog["slug"]) else {
      return nil
    }
    // A null optional provider field means it was not advertised. A malformed value
    // must fail the refresh rather than silently change a preset's available options.
    func optional(_ key: String) -> Any? {
      let value = catalog[key]
      return value is NSNull ? nil : value
    }
    let display = optional("display_name")
    let defaultEffort = optional("default_reasoning_level") ?? optional("default_reasoning_effort")
    guard display == nil || text(display, max: 1000) != nil,
      defaultEffort == nil || text(defaultEffort, max: 64) != nil
    else { return nil }
    let displayName = text(display, max: 1000) ?? slug
    let defaultReasoningEffort = text(defaultEffort, max: 64) ?? ""

    let efforts =
      optional("supported_reasoning_levels") ?? optional("supported_reasoning_efforts") ?? []
    guard let values = efforts as? [[String: Any]], values.count <= 100 else { return nil }
    var seen = Set<String>()
    var options: [String] = []
    for value in values {
      guard let effort = text(value["effort"] ?? value["reasoning_effort"], max: 64),
        seen.insert(effort).inserted
      else { return nil }
      options.append(effort)
    }

    func tierID(_ value: Any?) -> String? {
      guard let id = text(value, max: 64),
        id.range(of: "^[a-z][a-z0-9_-]{0,63}$", options: .regularExpression) != nil
      else { return nil }
      return id
    }
    let explicitFastTier: String?
    if let raw = optional("service_tiers") {
      guard let values = raw as? [[String: Any]], values.count <= 100 else { return nil }
      var firstFastTier: String?
      seen.removeAll()
      for value in values {
        guard let id = tierID(value["id"]), seen.insert(id).inserted else { return nil }
        if id == "fast" || id == "priority" || (value["name"] as? String)?.lowercased() == "fast" {
          firstFastTier = firstFastTier ?? id
        }
      }
      explicitFastTier = firstFastTier
    } else {
      explicitFastTier = nil
    }
    let additionalFastTier: String?
    if let raw = optional("additional_speed_tiers") {
      guard let tiers = raw as? [String], tiers.count <= 100,
        tiers.allSatisfy({ tierID($0) != nil }), Set(tiers).count == tiers.count
      else { return nil }
      additionalFastTier = tiers.first { $0 == "fast" || $0 == "priority" }
    } else {
      additionalFastTier = nil
    }
    let isDefault: Bool
    if let raw = optional("is_default") {
      guard let value = raw as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID()
      else { return nil }
      isDefault = value.boolValue
    } else {
      isDefault = false
    }
    return ConnectionModel(
      id: slug, name: displayName, capabilities: [.write], efforts: options,
      defaultEffort: defaultReasoningEffort, fastTier: explicitFastTier ?? additionalFastTier,
      isDefault: isDefault)
  }
}
