/**
 * La chiave dello stato del bottone di un plugin nella barra. Sta qui, da
 * sola, perché la usano in due che non devono importarsi a vicenda: il bottone
 * (`PluginBarButtons`) e il canale in tempo reale (`useNotifications`), che la
 * invalida quando il plugin manda il suo segnale.
 */
export const chiaveBarra = (nome: string) => ["plugin-barra", nome];
