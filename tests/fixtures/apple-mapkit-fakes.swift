// Deterministic stand-ins. This executable imports Foundation only, never MapKit.
import Foundation

private final class Promise {
  var value: Any?
  var code: String?
  var message: String?
  var settlements = 0
  func resolve(_ value: Any?) { self.value = value; settlements += 1 }
  func reject(_ code: String, _ message: String) { self.code = code; self.message = message; settlements += 1 }
}
private struct CLLocationCoordinate2D { var latitude: Double; var longitude: Double }
private func CLLocationCoordinate2DIsValid(_ coordinate: CLLocationCoordinate2D) -> Bool {
  coordinate.latitude.isFinite && coordinate.longitude.isFinite && abs(coordinate.latitude) <= 90 && abs(coordinate.longitude) <= 180
}
private struct MKMapRect { static let world = MKMapRect() }
private struct MKCoordinateRegion {
  var center: CLLocationCoordinate2D
  var spansWorld = false
  init(center: CLLocationCoordinate2D = .init(latitude: 0, longitude: 0), latitudinalMeters: Double = 0, longitudinalMeters: Double = 0) { self.center = center }
  init(_ rect: MKMapRect) { center = .init(latitude: 0, longitude: 0); spansWorld = true }
}
private struct ResultTypes: OptionSet {
  let rawValue: Int
  static let address = ResultTypes(rawValue: 1), pointOfInterest = ResultTypes(rawValue: 2), query = ResultTypes(rawValue: 4)
}
private protocol MKLocalSearchCompleterDelegate: AnyObject {
  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter)
  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error)
}
private final class MKLocalSearchCompletion {
  let title: String, subtitle: String
  init(_ title: String, _ subtitle: String = "Synthetic address") { self.title = title; self.subtitle = subtitle }
}
private final class MKLocalSearchCompleter: NSObject {
  static var instances: [MKLocalSearchCompleter] = []
  weak var delegate: MKLocalSearchCompleterDelegate?
  var region = MKCoordinateRegion(), resultTypes: ResultTypes = [], results: [MKLocalSearchCompletion] = []
  var isSearching = false, cancelled = false
  var queryFragment = "" { didSet { isSearching = true } }
  override init() { super.init(); Self.instances.append(self) }
  func cancel() { cancelled = true; isSearching = false }
  func update(_ results: [MKLocalSearchCompletion], searching: Bool = false) {
    self.results = results; isSearching = searching; delegate?.completerDidUpdateResults(self)
  }
}
private struct PostalAddress { var text: String }
private enum CNPostalAddressFormatter {
  enum Style { case mailingAddress }
  static func string(from address: PostalAddress, style: Style) -> String { address.text }
}
private struct Placemark {
  var coordinate = CLLocationCoordinate2D(latitude: 37.553, longitude: -121.980)
  var postalAddress: PostalAddress? = PostalAddress(text: "Synthetic address\nFremont")
  var title: String? = "Synthetic address"
}
private struct MapItem {
  final class Identifier {
    let rawValue: String
    init?(rawValue: String) {
      if rawValue == "Malformed-native-ID" { return nil }
      self.rawValue = rawValue
    }
  }
  var name: String? = "Synthetic restaurant"
  var placemark = Placemark()
  var identifier: Identifier?
}
private typealias MKMapItem = MapItem
private final class MKMapItemRequest {
  static var instances: [MKMapItemRequest] = []
  let mapItemIdentifier: MKMapItem.Identifier
  var cancelled = false
  var callback: ((MKMapItem?, Error?) -> Void)?
  init(mapItemIdentifier: MKMapItem.Identifier) { self.mapItemIdentifier = mapItemIdentifier; Self.instances.append(self) }
  func getMapItem(completionHandler: @escaping (MKMapItem?, Error?) -> Void) { callback = completionHandler }
  func cancel() { cancelled = true }
  func finish(_ item: MKMapItem? = MKMapItem(), error: Error? = nil) { callback?(item, error) }
}
private struct SearchResponse { var mapItems: [MapItem] }
private struct MKError: Error { enum Code { case placemarkNotFound, serverFailure }; var code: Code }
private final class MKLocalSearch {
  final class Request {
    var naturalLanguageQuery: String?, region = MKCoordinateRegion(), resultTypes: ResultTypes = []
    var completion: MKLocalSearchCompletion?
    init() {}
    init(completion: MKLocalSearchCompletion) { self.completion = completion }
  }
  static var instances: [MKLocalSearch] = []
  let request: Request
  var cancelled = false
  var callback: ((SearchResponse?, Error?) -> Void)?
  init(request: Request) { self.request = request; Self.instances.append(self) }
  func start(completionHandler: @escaping (SearchResponse?, Error?) -> Void) { callback = completionHandler }
  func cancel() { cancelled = true }
  func finish(_ items: [MapItem] = [MapItem()], error: Error? = nil) { callback?(SearchResponse(mapItems: items), error) }
}

// ENGINE_INSERTION_POINT

private func runTests() {
  var passed = 0
  func check(_ name: String, _ body: () -> Void) { body(); passed += 1; print("PASS " + name) }
  func rows(_ promise: Promise) -> [[String: Any]] { promise.value as! [[String: Any]] }

  check("Empty in-progress completion update cannot cancel later selectable results") {
    let session = MapKitSearchSession(), promise = Promise()
    session.complete(query: "Chipotle Fremont", mode: "business", requestId: "1", promise: promise)
    let completer = MKLocalSearchCompleter.instances.last!
    assert(completer.queryFragment == "Chipotle Fremont")
    assert(completer.resultTypes.contains(.pointOfInterest) && completer.resultTypes.contains(.query))
    completer.update([], searching: true)
    assert(promise.settlements == 0 && !completer.cancelled)
    completer.update([MKLocalSearchCompletion("Synthetic restaurant")])
    assert(promise.settlements == 1 && rows(promise).count == 1 && completer.cancelled)
    let resolution = Promise()
    session.resolve(suggestionId: "1:0", requestId: "2", promise: resolution)
    let search = MKLocalSearch.instances.last!
    assert(search.request.completion?.title == "Synthetic restaurant")
    search.finish([MapItem(), MapItem(name: "Other synthetic restaurant")])
    assert(rows(resolution).count == 2 && rows(resolution)[0]["source"] as? String == "apple-maps-preview")
    session.reset()
  }
  check("Completed empty autocomplete is distinct from pending and errors") {
    let session = MapKitSearchSession(), promise = Promise()
    session.complete(query: "2760 Mowry Avenue, Fremont", mode: "address", requestId: "3", promise: promise)
    let completer = MKLocalSearchCompleter.instances.last!
    assert(completer.resultTypes == [.address])
    completer.update([])
    assert(promise.code == nil && rows(promise).isEmpty && promise.settlements == 1)
    session.reset()
  }
  check("Autocomplete errors reject visibly using a fixed safe code and never fabricate an empty result") {
    let session = MapKitSearchSession(), promise = Promise()
    session.complete(query: "Synthetic query", mode: "business", requestId: "12", promise: promise)
    let completer = MKLocalSearchCompleter.instances.last!
    session.completer(completer, didFailWithError: NSError(domain: "private raw error", code: 99))
    assert(promise.code == "ERR_UNAVAILABLE" && promise.value == nil && completer.cancelled)
    assert(promise.message == "Apple search stopped." && promise.settlements == 1)
  }
  check("Direct business and address queries use MapKit search once without autocomplete or fabricated results") {
    for (mode, query) in [("business", "Chipotle Fremont"), ("address", "2760 Mowry Avenue, Fremont")] {
      let session = MapKitSearchSession(), promise = Promise(), before = MKLocalSearchCompleter.instances.count
      session.searchPlaces(query: query, mode: mode, requestId: "4", promise: promise)
      let search = MKLocalSearch.instances.last!
      assert(search.request.naturalLanguageQuery == query && search.request.completion == nil)
      assert(search.request.resultTypes == (mode == "business" ? [.pointOfInterest] : [.address]))
      assert(MKLocalSearchCompleter.instances.count == before)
      search.finish(); assert(rows(promise).count == 1 && rows(promise)[0]["kind"] as? String == mode)
      session.reset()
    }
  }
  check("Cancelled and replaced native searches cannot publish late results or resolve obsolete completions") {
    let session = MapKitSearchSession(), old = Promise(), fresh = Promise()
    session.complete(query: "Old query", mode: "business", requestId: "5", promise: old)
    let staleCompleter = MKLocalSearchCompleter.instances.last!
    session.searchPlaces(query: "New query", mode: "business", requestId: "6", promise: fresh)
    staleCompleter.results = [MKLocalSearchCompletion("Obsolete")]; session.completerDidUpdateResults(staleCompleter)
    assert(old.code == "ERR_CANCELLED" && old.settlements == 1 && fresh.settlements == 0)
    let search = MKLocalSearch.instances.last!
    session.cancel(requestId: "5"); assert(!search.cancelled)
    session.cancel(requestId: "6"); assert(search.cancelled && fresh.code == "ERR_CANCELLED")
    search.finish(); assert(fresh.settlements == 1)
    let invalid = Promise(); session.resolve(suggestionId: "5:0", requestId: "7", promise: invalid)
    assert(invalid.code == "ERR_INVALID")
  }
  check("Native empty search and placemark-not-found return no results; other failures remain sanitized") {
    for code in [MKError.Code.placemarkNotFound, .serverFailure] {
      let session = MapKitSearchSession(), promise = Promise()
      session.searchPlaces(query: "Synthetic query", mode: "business", requestId: "8", promise: promise)
      MKLocalSearch.instances.last!.finish([], error: MKError(code: code))
      if code == .placemarkNotFound { assert(rows(promise).isEmpty && promise.code == nil) }
      else { assert(promise.code == "ERR_UNAVAILABLE" && promise.message == "Apple search is unavailable.") }
      assert(promise.settlements == 1); session.reset()
    }
  }
  check("Native timeout cancels the provider operation, rejects once and ignores subsequent completion") {
    let session = MapKitSearchSession(), promise = Promise()
    session.searchPlaces(query: "Synthetic query", mode: "business", requestId: "9", promise: promise)
    let search = MKLocalSearch.instances.last!
    let work = Mirror(reflecting: session).children.first { $0.label == "timeout" }!.value as! DispatchWorkItem?
    work!.perform() // Exercise the real deadline callback immediately, without an eight-second wait.
    assert(promise.code == "ERR_TIMEOUT" && search.cancelled)
    search.finish(); assert(promise.settlements == 1)
  }
  check("Native validation blocks invalid text and coordinates before preview") {
    let session = MapKitSearchSession(), invalid = Promise(), before = MKLocalSearch.instances.count
    session.searchPlaces(query: "bad\nquery", mode: "business", requestId: "10", promise: invalid)
    assert(invalid.code == "ERR_INVALID" && MKLocalSearch.instances.count == before)
    let promise = Promise(); session.searchPlaces(query: "Synthetic query", mode: "address", requestId: "11", promise: promise)
    var bad = MapItem(); bad.placemark.coordinate.latitude = .infinity
    MKLocalSearch.instances.last!.finish([bad]); assert(rows(promise).isEmpty)
    session.reset()
  }
  check("Both search paths expose optional raw Place IDs without changing temporary handles") {
    for direct in [false, true] {
      let session = MapKitSearchSession(), promise = Promise()
      if direct { session.searchPlaces(query: "Synthetic query", mode: "business", requestId: "20", promise: promise) }
      else {
        let completion = Promise()
        session.complete(query: "Synthetic query", mode: "business", requestId: "19", promise: completion)
        MKLocalSearchCompleter.instances.last!.update([MKLocalSearchCompletion("Synthetic restaurant")])
        session.resolve(suggestionId: "19:0", requestId: "20", promise: promise)
      }
      let item = MKMapItem(identifier: .init(rawValue: "Opaque:Mixed-Case/ref"))
      MKLocalSearch.instances.last!.finish([item, MKMapItem()])
      assert(rows(promise)[0]["id"] as? String == "20:0")
      assert(rows(promise)[0]["placeId"] as? String == "Opaque:Mixed-Case/ref")
      assert(rows(promise)[1]["id"] as? String == "20:1" && rows(promise)[1]["placeId"] == nil)
    }
  }
  check("Identifier lookup uses only MKMapItemRequest and allows a current alias or absent returned ID") {
    for returnedId in ["Current-Alias", nil] {
      let session = MapKitSearchSession(), promise = Promise()
      let before = MKLocalSearch.instances.count, completionsBefore = MKLocalSearchCompleter.instances.count
      session.lookupPlace(placeId: "Opaque:Mixed-Case/ref", mode: "address", requestId: "21", promise: promise)
      let request = MKMapItemRequest.instances.last!
      assert(request.mapItemIdentifier.rawValue == "Opaque:Mixed-Case/ref")
      request.finish(MKMapItem(identifier: returnedId.flatMap { .init(rawValue: $0) }))
      assert(rows(promise).count == 1 && rows(promise)[0]["id"] as? String == "21:0")
      assert(rows(promise)[0]["kind"] as? String == "address" && rows(promise)[0]["source"] as? String == "apple-maps-preview")
      assert(rows(promise)[0]["placeId"] as? String == returnedId)
      assert(MKLocalSearch.instances.count == before && MKLocalSearchCompleter.instances.count == completionsBefore)
      assert(promise.settlements == 1)
      request.finish(); assert(promise.settlements == 1)
      session.reset()
    }
  }
  check("Lookup validates references, request IDs and modes without invoking MapKit") {
    for (placeId, mode, requestId) in [("", "business", "22"), (" padded", "business", "22"),
      ("bad\nID", "business", "22"), (String(repeating: "x", count: 301), "business", "22"),
      ("Malformed-native-ID", "business", "22"), ("Opaque-ID", "other", "22"), ("Opaque-ID", "business", "bad")] {
      let session = MapKitSearchSession(), promise = Promise(), before = MKMapItemRequest.instances.count
      session.lookupPlace(placeId: placeId, mode: mode, requestId: requestId, promise: promise)
      assert(promise.code == "ERR_INVALID" && promise.settlements == 1 && MKMapItemRequest.instances.count == before)
    }
  }
  check("Lookup no-results, invalid geometry and transport failures have safe distinct outcomes") {
    for code in [MKError.Code.placemarkNotFound, .serverFailure] {
      let session = MapKitSearchSession(), promise = Promise()
      session.lookupPlace(placeId: "Opaque-ID", mode: "business", requestId: "23", promise: promise)
      MKMapItemRequest.instances.last!.finish(nil, error: MKError(code: code))
      if code == .placemarkNotFound { assert(rows(promise).isEmpty && promise.code == nil) }
      else { assert(promise.code == "ERR_UNAVAILABLE" && promise.message == "Apple lookup is unavailable.") }
      assert(promise.settlements == 1)
    }
    var invalid = MKMapItem(); invalid.placemark.coordinate.latitude = .infinity
    for item in [nil, invalid] {
      let session = MapKitSearchSession(), promise = Promise()
      session.lookupPlace(placeId: "Opaque-ID", mode: "business", requestId: "24", promise: promise)
      MKMapItemRequest.instances.last!.finish(item)
      assert(rows(promise).isEmpty && promise.code == nil && promise.settlements == 1)
    }
  }
  check("Lookup cancellation/reset/timeout reject once and ignore late callbacks") {
    for action in ["cancel", "reset", "timeout"] {
      let session = MapKitSearchSession(), promise = Promise()
      session.lookupPlace(placeId: "Opaque-ID", mode: "business", requestId: "25", promise: promise)
      let request = MKMapItemRequest.instances.last!
      session.cancel(requestId: "999"); assert(!request.cancelled)
      if action == "cancel" { session.cancel(requestId: "25") }
      if action == "reset" { session.reset() }
      if action == "timeout" {
        let work = Mirror(reflecting: session).children.first { $0.label == "timeout" }!.value as! DispatchWorkItem?
        work!.perform()
      }
      assert(request.cancelled && promise.code == (action == "timeout" ? "ERR_TIMEOUT" : "ERR_CANCELLED"))
      request.finish(); assert(promise.settlements == 1 && promise.value == nil)
    }
  }
  check("Search and lookup replacement cancel old work even when request IDs repeat") {
    let session = MapKitSearchSession(), old = Promise(), fresh = Promise(), searched = Promise()
    session.searchPlaces(query: "Synthetic query", mode: "business", requestId: "26", promise: searched)
    let search = MKLocalSearch.instances.last!
    session.lookupPlace(placeId: "Old-ID", mode: "business", requestId: "26", promise: old)
    assert(search.cancelled && searched.code == "ERR_CANCELLED")
    search.finish(); assert(searched.settlements == 1)
    let oldRequest = MKMapItemRequest.instances.last!
    session.lookupPlace(placeId: "New-ID", mode: "business", requestId: "26", promise: fresh)
    assert(oldRequest.cancelled && old.code == "ERR_CANCELLED")
    oldRequest.finish(); assert(old.settlements == 1 && fresh.settlements == 0)
    let freshRequest = MKMapItemRequest.instances.last!, next = Promise()
    session.complete(query: "Synthetic query", mode: "business", requestId: "27", promise: next)
    assert(freshRequest.cancelled && fresh.code == "ERR_CANCELLED")
    freshRequest.finish(); assert(fresh.settlements == 1)
    let stale = Promise(); session.resolve(suggestionId: "19:0", requestId: "28", promise: stale)
    assert(stale.code == "ERR_INVALID"); session.reset()
  }
  check("Address autocomplete, resolution and text search use a world region; businesses retain Fremont") {
    for mode in ["address", "business"] {
      let session = MapKitSearchSession(), completion = Promise()
      session.complete(query: "Synthetic street, Other City", mode: mode, requestId: "30", promise: completion)
      let completer = MKLocalSearchCompleter.instances.last!
      assert(completer.region.spansWorld == (mode == "address"))
      if mode == "business" { assert(completer.region.center.latitude == 37.5555) }
      completer.update([MKLocalSearchCompletion("Synthetic street")])
      let resolved = Promise()
      session.resolve(suggestionId: "30:0", requestId: "31", promise: resolved)
      let resolution = MKLocalSearch.instances.last!
      assert(resolution.request.region.spansWorld == (mode == "address"))
      resolution.finish()
      let searched = Promise()
      session.searchPlaces(query: "Synthetic street, Other City", mode: mode, requestId: "32", promise: searched)
      let search = MKLocalSearch.instances.last!
      assert(search.request.region.spansWorld == (mode == "address"))
      if mode == "business" { assert(search.request.region.center.longitude == -121.9830) }
      search.finish(); session.reset()
    }
  }
  check("Unnamed ordinary addresses outside Fremont remain selectable with optional real identifiers") {
    for name in [nil, "", "   "] {
      let session = MapKitSearchSession(), promise = Promise()
      session.searchPlaces(query: "Synthetic street, Other City", mode: "address", requestId: "33", promise: promise)
      var unnamed = MKMapItem(name: name)
      unnamed.placemark.coordinate = .init(latitude: 40.7, longitude: -74.0)
      unnamed.placemark.postalAddress = .init(text: "Synthetic street, Other City")
      var identified = unnamed; identified.identifier = .init(rawValue: "Opaque-Address-ID")
      MKLocalSearch.instances.last!.finish([unnamed, identified])
      assert(rows(promise).count == 2)
      assert(rows(promise)[0]["id"] as? String == "33:0" && rows(promise)[1]["id"] as? String == "33:1")
      assert(rows(promise)[0]["name"] as? String == "Synthetic street, Other City")
      assert(rows(promise)[0]["latitude"] as? Double == 40.7 && rows(promise)[0]["longitude"] as? Double == -74.0)
      assert(rows(promise)[0]["kind"] as? String == "address" && rows(promise)[0]["placeId"] == nil)
      assert(rows(promise)[1]["placeId"] as? String == "Opaque-Address-ID")
    }
    let session = MapKitSearchSession(), invalid = Promise()
    session.searchPlaces(query: "Synthetic street, Other City", mode: "address", requestId: "34", promise: invalid)
    var noAddress = MKMapItem(name: nil)
    noAddress.placemark.postalAddress = nil; noAddress.placemark.title = nil
    var badGeometry = MKMapItem(name: nil); badGeometry.placemark.coordinate.longitude = .infinity
    MKLocalSearch.instances.last!.finish([noAddress, badGeometry])
    assert(rows(invalid).isEmpty)
    let business = Promise()
    session.searchPlaces(query: "Synthetic restaurant", mode: "business", requestId: "35", promise: business)
    MKLocalSearch.instances.last!.finish([MKMapItem(name: nil)])
    assert(rows(business).isEmpty) // No manufactured business name.
  }
  check("Address completion and ID lookup share the unnamed-address fallback without inventing IDs") {
    let session = MapKitSearchSession(), completion = Promise(), resolved = Promise(), lookedUp = Promise()
    session.complete(query: "Synthetic street, Other City", mode: "address", requestId: "36", promise: completion)
    MKLocalSearchCompleter.instances.last!.update([MKLocalSearchCompletion("Synthetic street")])
    session.resolve(suggestionId: "36:0", requestId: "37", promise: resolved)
    let item = MKMapItem(name: "")
    MKLocalSearch.instances.last!.finish([item])
    assert(rows(resolved)[0]["name"] as? String == "Synthetic address, Fremont")
    assert(rows(resolved)[0]["placeId"] == nil)
    session.lookupPlace(placeId: "Existing-Address-ID", mode: "address", requestId: "38", promise: lookedUp)
    MKMapItemRequest.instances.last!.finish(item)
    assert(rows(lookedUp)[0]["name"] as? String == "Synthetic address, Fremont")
    assert(rows(lookedUp)[0]["placeId"] == nil) // Do not synthesize the requested ID.
  }
  check("Fresh address sessions reissue the query without completion-cache or Place ID dependence") {
    for _ in 0..<2 {
      let session = MapKitSearchSession(), promise = Promise()
      let before = MKLocalSearch.instances.count
      session.searchPlaces(query: "Synthetic street, Other City", mode: "address", requestId: "1", promise: promise)
      assert(MKLocalSearch.instances.count == before + 1)
      let search = MKLocalSearch.instances.last!
      assert(search.request.naturalLanguageQuery == "Synthetic street, Other City")
      assert(search.request.completion == nil && search.request.resultTypes == [.address])
      search.finish([MKMapItem(name: nil)])
      assert(rows(promise).count == 1 && rows(promise)[0]["placeId"] == nil)
      session.reset()
    }
  }
  print("\(passed) offline Swift MapKit engine checks passed.")
}
runTests()
