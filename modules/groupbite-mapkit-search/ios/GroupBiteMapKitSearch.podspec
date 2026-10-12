Pod::Spec.new do |s|
  s.name = 'GroupBiteMapKitSearch'
  s.version = '0.1.0'
  s.summary = 'Development-only Apple Maps search preview'
  s.description = s.summary
  s.license = { :type => 'UNLICENSED' }
  s.author = 'GroupBite'
  s.homepage = 'https://developer.apple.com/documentation/mapkit'
  s.source = { :path => '.' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MapKit', 'Contacts'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS[config=Debug]' => '$(inherited) DEBUG'
  }
end
