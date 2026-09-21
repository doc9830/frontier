package net.doc9830.frontier

/**
 * One funnel for updater progress. The running activity subscribes here and
 * pushes every event both into the game (over the JS bridge) and, when needed,
 * into a native toast — so the web UI and the shell never disagree about state.
 */
object UpdateEvents {
    /** The most recent event, replayed to a web page that has just been reloaded. */
    @Volatile
    var last: String = ""

    @Volatile
    private var listener: ((String) -> Unit)? = null

    fun register(callback: ((String) -> Unit)?) {
        listener = callback
    }

    fun emit(json: String) {
        last = json
        listener?.invoke(json)
    }
}
