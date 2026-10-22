import Contacts
import CoreLocation
import ExpoModulesCore
import MapKit

public final class GroupBiteMapKitSearchModule: Module {
  private let session = MapKitSearchSession()
  private var location: MapLocationSession?

  public func definition() -> ModuleDefinition {
    Name("GroupBiteMapKitSearch")
    Function("isAvailable") { () -> Bool in
      #if DEBUG
      return true
      #else
      return false
      #endif
    }
    Function("supportsPlaceIdLookup") { () -> Bool in
      #if DEBUG
      if #available(iOS 18.0, *) { return true }
      #endif
      return false
    }
    AsyncFunction("requestCurrentLocation") { (promise: Promise) in
      #if DEBUG
      if self.location == nil { self.location = MapLocationSession() }
      self.location?.request(promise)
      #else
      promise.resolve(["status": "unavailable"])
      #endif
    }.runOnQueue(.main)
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
    AsyncFunction("lookupPlace") { (placeId: String, mode: String, requestId: String, promise: Promise) in
      #if DEBUG
      self.session.lookupPlace(placeId: placeId, mode: mode, requestId: requestId, promise: promise)
      #else
      promise.reject("ERR_DISABLED", "Apple search preview is disabled.")
      #endif
    }.runOnQueue(.main)
    AsyncFunction("cancel") { (requestId: String) in self.session.cancel(requestId: requestId) }.runOnQueue(.main)
    AsyncFunction("reset") { self.session.reset() }.runOnQueue(.main)
    OnAppEntersBackground { DispatchQueue.main.async { self.session.reset(); self.location?.cancel() } }
    OnDestroy { DispatchQueue.main.async { self.session.reset(); self.location?.cancel() } }
  }
}

// A button-initiated foreground request only. No persistence, background tracking,
// search-region changes, or reuse as a saved restaurant coordinate.
private final class MapLocationSession: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var pending: Promise?
  private var timeout: DispatchWorkItem?

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
  }
  func request(_ promise: Promise) {
    guard pending == nil else { promise.resolve(["status": "busy"]); return }
    pending = promise
    let work = DispatchWorkItem { [weak self] in self?.finish("timeout") }
    timeout = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: work)
    guard CLLocationManager.locationServicesEnabled() else { finish("disabled"); return }
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
    case .denied, .restricted: finish("denied")
    @unknown default: finish("unavailable")
    }
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard pending != nil else { return }
    switch manager.authorizationStatus {
    case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
    case .denied, .restricted: finish("denied")
    default: break
    }
  }
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let value = locations.last, value.horizontalAccuracy >= 0,
      abs(value.timestamp.timeIntervalSinceNow) <= 60, CLLocationCoordinate2DIsValid(value.coordinate),
      value.coordinate.latitude.isFinite, value.coordinate.longitude.isFinite else { finish("unavailable"); return }
    finish("granted", coordinate: value.coordinate)
  }
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish("unavailable") }
  func cancel() { finish("cancelled") }
  private func finish(_ status: String, coordinate: CLLocationCoordinate2D? = nil) {
    timeout?.cancel(); timeout = nil; manager.stopUpdatingLocation()
    guard let promise = pending else { return }; pending = nil
    if let coordinate {
      promise.resolve(["status": status, "latitude": coordinate.latitude, "longitude": coordinate.longitude])
    } else { promise.resolve(["status": status]) }
  }
}

// Suggestions resolve only cached native completions; Place IDs use MapKit lookup.
// No client coordinates,
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
  // Avoid storing an iOS-18-only type on a session supporting older iOS versions.
  private var cancelLookup: (() -> Void)?
  private var lookupId: String?
  private var lookupToken: UUID?
  private var lookupPromise: Promise?
  private var timeout: DispatchWorkItem?
  // Keep the business experiment's Fremont hint; addresses can be anywhere. No GPS.
  private let region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 37.5555, longitude: -121.9830),
    latitudinalMeters: 20000, longitudinalMeters: 20000)
  private let addressRegion = MKCoordinateRegion(MKMapRect.world)

  private func validId(_ id: String) -> Bool {
    !id.isEmpty && id.count <= 20 && id.allSatisfy { $0.isASCII && $0.isNumber }
  }
  private func validPlaceId(_ id: String) -> Bool {
    !id.isEmpty && id.unicodeScalars.count <= 300 && id == id.trimmingCharacters(in: .whitespacesAndNewlines) &&
      !id.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
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
    completer.region = mode == "business" ? region : addressRegion
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
    guard validId(requestId), let completion = completions[suggestionId], searchPromise == nil, lookupPromise == nil else {
      promise.reject("ERR_INVALID", "Select a current suggestion."); return
    }
    let request = MKLocalSearch.Request(completion: completion)
    request.region = mode == "business" ? region : addressRegion
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
    request.region = mode == "business" ? region : addressRegion
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
        if let location = self.location(item, id: "\(requestId):\(index)", mode: mode, fallbackName: fallbackName) {
          locations.append(location)
        }
      }
      promise.resolve(locations) // Multiple matches remain selectable; never guess the first.
    }
  }
  private func location(_ item: MKMapItem, id: String, mode: String, fallbackName: String = "") -> [String: Any]? {
    let coordinate = item.placemark.coordinate
    guard CLLocationCoordinate2DIsValid(coordinate), coordinate.latitude.isFinite, coordinate.longitude.isFinite,
      !(coordinate.latitude == 0 && coordinate.longitude == 0) else { return nil }
    let postalAddress = item.placemark.postalAddress.map {
      CNPostalAddressFormatter.string(from: $0, style: .mailingAddress)
        .components(separatedBy: .newlines).filter { !$0.isEmpty }.joined(separator: ", ")
    }
    let address = display(postalAddress ?? item.placemark.title ?? "", limit: 500)
    var name = display(item.name ?? fallbackName, limit: 200)
    // An ordinary address need not have a business name. Use its returned address
    // as a display label; never invent a place, coordinate or provider identifier.
    if name.isEmpty && mode == "address" { name = display(address, limit: 200) }
    guard !name.isEmpty, !address.isEmpty else { return nil }
    var location: [String: Any] = ["id": id, "name": name, "address": address,
      "latitude": coordinate.latitude, "longitude": coordinate.longitude,
      "source": "apple-maps-preview", "kind": mode]
    // Prefer the postal address, falling back only to other native placemark
    // fields. Locality is the city; subLocality is never promoted to a city.
    func component(_ preferred: String?, fallback: String? = nil) -> Any {
      for value in [preferred, fallback] {
        guard let value else { continue }
        let cleaned = value.components(separatedBy: .controlCharacters).joined(separator: " ")
          .trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleaned.isEmpty { return cleaned }
      }
      return NSNull()
    }
    let postal = item.placemark.postalAddress
    let street = [item.placemark.subThoroughfare, item.placemark.thoroughfare].compactMap { $0 }.joined(separator: " ")
    let components: [String: Any] = ["street": component(postal?.street, fallback: street),
      "city": component(postal?.city, fallback: item.placemark.locality),
      "region": component(postal?.state, fallback: item.placemark.administrativeArea),
      "postal_code": component(postal?.postalCode, fallback: item.placemark.postalCode),
      "country": component(postal?.country, fallback: item.placemark.country),
      "country_code": component(postal?.isoCountryCode.uppercased(), fallback: item.placemark.isoCountryCode?.uppercased())]
    if components.values.contains(where: { !($0 is NSNull) }) {
      location["structuredAddress"] = components
    }
    #if DEBUG
    if #available(iOS 18.0, *), let placeId = item.identifier?.rawValue, validPlaceId(placeId) {
      location["placeId"] = placeId
    }
    #endif
    return location
  }
  // Explicit identifier lookup, without a search fallback or persistence.
  func lookupPlace(placeId: String, mode: String, requestId: String, promise: Promise) {
    guard validId(requestId), validPlaceId(placeId), ["business", "address"].contains(mode) else {
      promise.reject("ERR_INVALID", "Select a valid Apple Place ID."); return
    }
    guard #available(iOS 18.0, *) else {
      promise.reject("ERR_UNSUPPORTED", "Place ID lookup requires iOS 18 or later."); return
    }
    guard let identifier = MKMapItem.Identifier(rawValue: placeId) else {
      promise.reject("ERR_INVALID", "Select a valid Apple Place ID."); return
    }
    reset()
    let request = MKMapItemRequest(mapItemIdentifier: identifier), token = UUID()
    lookupId = requestId; lookupToken = token; lookupPromise = promise
    cancelLookup = { request.cancel() }
    armTimeout()
    request.getMapItem { [weak self] item, error in
      guard let self, self.lookupToken == token, let promise = self.lookupPromise else { return }
      self.timeout?.cancel(); self.timeout = nil
      self.cancelLookup = nil; self.lookupId = nil; self.lookupToken = nil; self.lookupPromise = nil
      if let mapError = error as? MKError, mapError.code == .placemarkNotFound {
        promise.resolve([] as [[String: Any]]); return
      }
      guard error == nil else {
        promise.reject("ERR_UNAVAILABLE", "Apple lookup is unavailable."); return
      }
      // Mode describes the originating search, not a new claim about accuracy.
      if let item, let location = self.location(item, id: "\(requestId):0", mode: mode) {
        promise.resolve([location])
      } else { promise.resolve([] as [[String: Any]]) }
    }
  }
  func cancel(requestId: String) {
    if requestId == completionId || requestId == searchId || requestId == lookupId { reset() }
  }
  func reset(code: String = "ERR_CANCELLED") {
    timeout?.cancel(); timeout = nil
    completer?.delegate = nil; completer?.cancel(); completer = nil
    search?.cancel(); search = nil
    // Clear the token before cancelling, including synchronously delivered callbacks.
    lookupToken = nil
    cancelLookup?(); cancelLookup = nil
    completionPromise?.reject(code, "Apple search stopped.")
    searchPromise?.reject(code, "Apple search stopped.")
    lookupPromise?.reject(code, "Apple lookup stopped.")
    completionPromise = nil; searchPromise = nil; completionId = nil; searchId = nil
    lookupPromise = nil; lookupId = nil
    completions.removeAll()
  }
}
