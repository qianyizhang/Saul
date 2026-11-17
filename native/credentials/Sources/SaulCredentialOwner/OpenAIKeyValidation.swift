import Foundation

public func validatedOpenAIKey(_ value: String) throws -> String {
  let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !key.isEmpty, key.utf8.count <= 512,
    key.utf8.allSatisfy({ $0 > 32 && $0 < 127 })
  else { throw OwnerRequestError("Enter a valid OpenAI API key without spaces.") }
  return key
}
