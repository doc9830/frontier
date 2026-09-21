# The JS bridge is called by name from the page, so nothing may be renamed there.
-keepclassmembers class net.doc9830.frontier.Bridge {
    public *;
}
-keep class net.doc9830.frontier.Bridge { *; }
