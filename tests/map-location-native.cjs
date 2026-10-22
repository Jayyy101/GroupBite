// Execute the actual Swift location controller with synthetic Core Location and
// promise boundaries. Never requests host/simulator permissions or real GPS.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const native = fs.readFileSync(path.join(__dirname, '../modules/groupbite-mapkit-search/ios/GroupBiteMapKitSearchModule.swift'), 'utf8');
const engine = native.slice(native.indexOf('private final class MapLocationSession:'), native.indexOf('// Suggestions resolve'));
const fixture = `
import Foundation
struct CLLocationCoordinate2D { let latitude: Double; let longitude: Double }
func CLLocationCoordinate2DIsValid(_ c: CLLocationCoordinate2D) -> Bool { abs(c.latitude)<=90 && abs(c.longitude)<=180 }
let kCLLocationAccuracyHundredMeters: Double = 100
enum Status { case notDetermined, authorizedAlways, authorizedWhenInUse, denied, restricted }
protocol CLLocationManagerDelegate: AnyObject {}
class CLLocationManager {
 static var enabled=true; static var initial=Status.notDetermined; static var last: CLLocationManager?
 weak var delegate: CLLocationManagerDelegate?
 var desiredAccuracy: Double=0; var authorizationStatus=CLLocationManager.initial
 var permissionCalls=0; var locationCalls=0; var stops=0
 init() { Self.last=self }
 static func locationServicesEnabled()->Bool { enabled }
 func requestWhenInUseAuthorization(){permissionCalls+=1}
 func requestLocation(){locationCalls+=1}
 func stopUpdatingLocation(){stops+=1}
}
struct CLLocation { let coordinate: CLLocationCoordinate2D; let horizontalAccuracy: Double; let timestamp: Date }
final class Promise { var values: [[String:Any]]=[]; func resolve(_ value:[String:Any]) { values.append(value) } }
final class DispatchWorkItem { let work:()->Void; var cancelled=false; init(block:@escaping ()->Void){work=block}; func cancel(){cancelled=true} }
final class DispatchQueue { static let main=DispatchQueue(); var work:DispatchWorkItem?; func asyncAfter(deadline:DispatchTime,execute:DispatchWorkItem){work=execute} }
// ENGINE
func check(_ condition: @autoclosure ()->Bool,_ text:String){ if !condition(){fatalError(text)};print("PASS "+text) }
private func setup(_ status:Status)->(MapLocationSession,CLLocationManager,Promise){CLLocationManager.enabled=true;CLLocationManager.initial=status;let s=MapLocationSession();return(s,CLLocationManager.last!,Promise())}
do { let(s,m,p)=setup(.notDetermined);s.request(p);check(m.permissionCalls==1 && m.locationCalls==0,"Location is button-initiated and asks only when undetermined");let busy=Promise();s.request(busy);check(busy.values.first?["status"] as? String == "busy","Duplicate requests cannot create a second location attempt");m.authorizationStatus = .denied;s.locationManagerDidChangeAuthorization(m);check(p.values.first?["status"] as? String == "denied","Permission denial resolves gracefully once");s.locationManagerDidChangeAuthorization(m);check(p.values.count==1,"Late authorization callbacks cannot settle twice") }
do { let(s,m,p)=setup(.authorizedWhenInUse);s.request(p);check(m.permissionCalls==0 && m.locationCalls==1,"Already-authorized foreground lookup does not reprompt");s.locationManager(m,didUpdateLocations:[CLLocation(coordinate:CLLocationCoordinate2D(latitude:37.5,longitude:-122),horizontalAccuracy:50,timestamp:Date())]);check(p.values.first?["latitude"] as? Double == 37.5,"Fresh genuine coordinates resolve without storage or search");check(m.stops>0,"Completed location requests stop updates") }
do { let(s,_,p)=setup(.denied);s.request(p);check(p.values.first?["status"] as? String == "denied","Existing denial does not request authorization") }
do { let(s,_,p)=setup(.notDetermined);CLLocationManager.enabled=false;s.request(p);check(p.values.first?["status"] as? String == "disabled","Disabled system services have a distinct outcome") }
do { let(s,m,p)=setup(.authorizedWhenInUse);s.request(p);s.cancel();s.locationManager(m,didUpdateLocations:[CLLocation(coordinate:CLLocationCoordinate2D(latitude:37,longitude:-122),horizontalAccuracy:1,timestamp:Date())]);check(p.values.count==1 && p.values.first?["status"] as? String == "cancelled","Background cancellation ignores later coordinates") }
do { let(s,m,p)=setup(.authorizedWhenInUse);s.request(p);s.locationManager(m,didUpdateLocations:[CLLocation(coordinate:CLLocationCoordinate2D(latitude:91,longitude:-122),horizontalAccuracy:1,timestamp:Date())]);check(p.values.first?["status"] as? String == "unavailable","Invalid location geometry never reaches the map") }
do { let(s,m,p)=setup(.authorizedWhenInUse);s.request(p);s.locationManager(m,didUpdateLocations:[CLLocation(coordinate:CLLocationCoordinate2D(latitude:37,longitude:-122),horizontalAccuracy:1,timestamp:Date(timeIntervalSinceNow:-120))]);check(p.values.first?["status"] as? String == "unavailable","Stale coordinates are rejected") }
do { let(s,_,p)=setup(.authorizedWhenInUse);s.request(p);DispatchQueue.main.work?.work();check(p.values.first?["status"] as? String == "timeout","A stalled location lookup times out once") }
`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groupbite-map-location-'));
try {
    const source = path.join(directory, 'main.swift'), binary = path.join(directory, 'checks');
    fs.writeFileSync(source, fixture.replace('// ENGINE', engine));
    const compiled = spawnSync('swiftc', ['-swift-version', '5', '-module-cache-path', path.join(directory, 'cache'), source, '-o', binary], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(binary, [], { encoding: 'utf8' }); assert.equal(executed.status, 0, executed.stderr); process.stdout.write(executed.stdout);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
