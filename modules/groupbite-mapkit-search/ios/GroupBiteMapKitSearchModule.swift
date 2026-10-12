import Contacts
import ExpoModulesCore
import MapKit

public final class GroupBiteMapKitSearchModule: Module {
  private let session = MapKitSearchSession()

  public func definition() -> ModuleDefinition {
    Name("GroupBiteMapKitSearch")
    Function("isAvailable") { () -> Bool in
      #if DEBUG
      return true
      #else
      return false
      #endif
    }
    AsyncFunction("complete") { (query: String, mode: String, requestId: String, promise: Promise) in
      #if DEBUG
      self.session.complete(query: query, mode: mode, requestId: requestId, promise: promise)
      #else
      promise.reject("ERR_DISABLED", "Apple search preview is disabled.")
      #endif
    }.runOnQueue(.main)
    AsyncFunction("search") { (query: String, mode: String, requestId: String, promise: Promise) in
      #if DEBUG
      self.session.searchPlaces(query: query, mode: mode, requestId: requestId, promise: promise)
      #else
      promise.reject("ERR_DISABLED", "Apple search preview is disabled.")
      #endif
    }.runOnQueue(.main)
    AsyncFunction("resolve") { (suggestionId: String, requestId: String, promise: Promise) in
      #if DEBUG
      self.session.resolve(suggestionId: suggestionId, requestId: requestId, promise: promise)
      #else
      promise.reject("ERR_DISABLED", "Apple search preview is disabled.")
      #endif
    }.runOnQueue(.main)
    AsyncFunction("cancel") { (requestId: String) in self.session.cancel(requestId: requestId) }.runOnQueue(.main)
    AsyncFunction("reset") { self.session.reset() }.runOnQueue(.main)
    OnAppEntersBackground { DispatchQueue.main.async { self.session.reset() } }
    OnDestroy { DispatchQueue.main.async { self.session.reset() } }
  }
}

// Only cached native completion objects may be resolved. No client coordinates,
// URLs, keys, persistence, location permissions or payload/exception logging.
private final class MapKitSearchSession: NSObject, MKLocalSearchCompleterDelegate {
  private var completer: MKLocalSearchCompleter?
  private var completions: [String: MKLocalSearchCompletion] = [:]
  private var completionId: String?
  private var completionPromise: Promise?
  private var mode = "business"
  private var search: MKLocalSearch?
  private var searchId: String?
  private var searchPromise: Promise?
  private var timeout: DispatchWorkItem?
  // A region hint, not a claim that all results are in Fremont. No device GPS.
  private let region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 37.5555, longitude: -121.9830),
    latitudinalMeters: 20000, longitudinalMeters: 20000)

  private func validId(_ id: String) -> Bool {
    !id.isEmpty && id.count <= 20 && id.allSatisfy { $0.isASCII && $0.isNumber }
  }
  private func display(_ value: String, limit: Int) -> String {
    String(value.components(separatedBy: .controlCharacters).joined(separator: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit))
  }
  private func validQuery(_ query: String, mode: String, requestId: String) -> Bool {
    validId(requestId) && (3...200).contains(query.count) && ["business", "address"].contains(mode) &&
      !query.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
  }
  private func armTimeout() {
    timeout?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.reset(code: "ERR_TIMEOUT") }
    timeout = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
  }
  func complete(query: String, mode: String, requestId: String, promise: Promise) {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard validQuery(query, mode: mode, requestId: requestId) else {
      promise.reject("ERR_INVALID", "Check the search text."); return
    }
    reset()
    self.mode = mode
    completionId = requestId
    completionPromise = promise
    let completer = MKLocalSearchCompleter()
    self.completer = completer
    completer.region = region
    // A restaurant query may complete to a query rather than a specific POI.
    // Configure before assigning the delegate to avoid configuration callbacks.
    completer.resultTypes = mode == "business" ? [.pointOfInterest, .query] : [.address]
    completer.delegate = self
    armTimeout()
    completer.queryFragment = query
  }
  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    guard self.completer === completer, let promise = completionPromise, let id = completionId else { return }
    // An empty update while work continues is not a completed no-results search.
    guard !completer.results.isEmpty || !completer.isSearching else { return }
    var suggestions: [[String: Any]] = []
    for (index, item) in completer.results.prefix(5).enumerated() {
      let title = display(item.title, limit: 200)
      guard !title.isEmpty else { continue }
      let resultId = "\(id):\(index)"
      completions[resultId] = item
      suggestions.append(["id": resultId, "title": title, "subtitle": display(item.subtitle, limit: 500)])
    }
    timeout?.cancel(); timeout = nil
    completionPromise = nil
    completer.delegate = nil; completer.cancel(); self.completer = nil
    promise.resolve(suggestions)
  }
  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    guard self.completer === completer else { return }
    reset(code: "ERR_UNAVAILABLE") // Never reflect the platform's raw error.
  }
  func resolve(suggestionId: String, requestId: String, promise: Promise) {
    guard validId(requestId), let completion = completions[suggestionId], searchPromise == nil else {
      promise.reject("ERR_INVALID", "Select a current suggestion."); return
    }
    let request = MKLocalSearch.Request(completion: completion)
    request.region = region
    request.resultTypes = mode == "business" ? [.pointOfInterest] : [.address]
    startSearch(request, mode: mode, requestId: requestId, fallbackName: completion.title, promise: promise)
  }
  // Explicit user action, not an automatic retry/fallback from autocomplete.
  func searchPlaces(query: String, mode: String, requestId: String, promise: Promise) {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard validQuery(query, mode: mode, requestId: requestId) else {
      promise.reject("ERR_INVALID", "Check the search text."); return
    }
    reset()
    self.mode = mode
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    request.region = region
    request.resultTypes = mode == "business" ? [.pointOfInterest] : [.address]
    startSearch(request, mode: mode, requestId: requestId, fallbackName: "", promise: promise)
  }
  private func startSearch(_ request: MKLocalSearch.Request, mode: String, requestId: String,
    fallbackName: String, promise: Promise) {
    let search = MKLocalSearch(request: request)
    self.search = search; searchId = requestId; searchPromise = promise
    armTimeout()
    search.start { [weak self, weak search] response, error in
      guard let self, let search, self.search === search, let promise = self.searchPromise else { return }
      self.timeout?.cancel(); self.timeout = nil
      self.search = nil; self.searchId = nil; self.searchPromise = nil
      if let mapError = error as? MKError, mapError.code == .placemarkNotFound {
        promise.resolve([] as [[String: Any]]); return
      }
      guard error == nil, let response else {
        promise.reject("ERR_UNAVAILABLE", "Apple search is unavailable."); return
      }
      var locations: [[String: Any]] = []
      for (index, item) in response.mapItems.prefix(5).enumerated() {
        let coordinate = item.placemark.coordinate
        guard CLLocationCoordinate2DIsValid(coordinate), coordinate.latitude.isFinite, coordinate.longitude.isFinite,
          !(coordinate.latitude == 0 && coordinate.longitude == 0) else { continue }
        let postalAddress = item.placemark.postalAddress.map {
          CNPostalAddressFormatter.string(from: $0, style: .mailingAddress)
            .components(separatedBy: .newlines).filter { !$0.isEmpty }.joined(separator: ", ")
        }
        let name = self.display(item.name ?? fallbackName, limit: 200)
        let address = self.display(postalAddress ?? item.placemark.title ?? "", limit: 500)
        guard !name.isEmpty, !address.isEmpty else { continue }
        locations.append(["id": "\(requestId):\(index)", "name": name, "address": address,
          "latitude": coordinate.latitude, "longitude": coordinate.longitude,
          "source": "apple-maps-preview", "kind": mode])
      }
      promise.resolve(locations) // Multiple matches remain selectable; never guess the first.
    }
  }
  func cancel(requestId: String) {
    if requestId == completionId || requestId == searchId { reset() }
  }
  func reset(code: String = "ERR_CANCELLED") {
    timeout?.cancel(); timeout = nil
    completer?.delegate = nil; completer?.cancel(); completer = nil
    search?.cancel(); search = nil
    completionPromise?.reject(code, "Apple search stopped.")
    searchPromise?.reject(code, "Apple search stopped.")
    completionPromise = nil; searchPromise = nil; completionId = nil; searchId = nil
    completions.removeAll()
  }
}
