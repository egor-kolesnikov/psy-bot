export const setDelay = async (ms = 1000) => {
    await new Promise(res => {
        setTimeout(res, ms)
    })
}
