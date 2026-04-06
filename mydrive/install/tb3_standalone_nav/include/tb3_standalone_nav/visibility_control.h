#ifndef TB3_STANDALONE_NAV__VISIBILITY_CONTROL_H_
#define TB3_STANDALONE_NAV__VISIBILITY_CONTROL_H_

#if defined _WIN32 || defined __CYGWIN__
  #ifdef __GNUC__
    #define TB3_STANDALONE_NAV_EXPORT __attribute__ ((dllexport))
    #define TB3_STANDALONE_NAV_IMPORT __attribute__ ((dllimport))
  #else
    #define TB3_STANDALONE_NAV_EXPORT __declspec(dllexport)
    #define TB3_STANDALONE_NAV_IMPORT __declspec(dllimport)
  #endif
  #ifdef TB3_STANDALONE_NAV_BUILDING_LIBRARY
    #define TB3_STANDALONE_NAV_PUBLIC TB3_STANDALONE_NAV_EXPORT
  #else
    #define TB3_STANDALONE_NAV_PUBLIC TB3_STANDALONE_NAV_IMPORT
  #endif
  #define TB3_STANDALONE_NAV_PUBLIC_TYPE TB3_STANDALONE_NAV_PUBLIC
  #define TB3_STANDALONE_NAV_LOCAL
#else
  #define TB3_STANDALONE_NAV_EXPORT __attribute__ ((visibility("default")))
  #define TB3_STANDALONE_NAV_IMPORT
  #if __GNUC__ >= 4
    #define TB3_STANDALONE_NAV_PUBLIC __attribute__ ((visibility("default")))
    #define TB3_STANDALONE_NAV_LOCAL  __attribute__ ((visibility("hidden")))
  #else
    #define TB3_STANDALONE_NAV_PUBLIC
    #define TB3_STANDALONE_NAV_LOCAL
  #endif
  #define TB3_STANDALONE_NAV_PUBLIC_TYPE
#endif

#endif  // TB3_STANDALONE_NAV__VISIBILITY_CONTROL_H_
