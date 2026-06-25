/** Pasajes eucarísticos para el kiosk de registro. */
const EUCHARISTIC_SCRIPTURES = [
    '«Yo soy el pan vivo que bajó del cielo; el que coma de este pan vivirá eternamente.» — Juan 6,51',
    '«Este es mi cuerpo, que es entregado por vosotros; haced esto en memoria de mí.» — Lucas 22,19',
    '«El que come mi carne y bebe mi sangre permanece en mí y yo en él.» — Juan 6,56',
    '«Venid a mí todos los que estáis cansados y agobiados, y yo os daré descanso.» — Mateo 11,28',
    '«Yo soy la vid y vosotros los sarmientos. El que permanece en mí y yo en él, ése da mucho fruto.» — Juan 15,5',
    '«El que come mi carne y bebe mi sangre tiene vida eterna.» — Juan 6,54',
    '«Eternamente permanecerá conmigo el que me ama.» — Juan 14,23',
    '«Mi carne es verdadera comida y mi sangre es verdadera bebida.» — Juan 6,55',
    '«Bendito el que viene en nombre del Señor.» — Marcos 11,9',
    '«El Señor está cerca de los que lo invocan, de los que lo invocan con sinceridad.» — Salmo 145,18',
    '«Mirad que estoy a la puerta y llamo; si alguno oye mi voz y abre la puerta, entraré.» — Apocalipsis 3,20',
    '«El que cree en mí, aunque muera, vivirá.» — Juan 11,25',
];

function randomScripture() {
    return EUCHARISTIC_SCRIPTURES[Math.floor(Math.random() * EUCHARISTIC_SCRIPTURES.length)];
}

module.exports = { EUCHARISTIC_SCRIPTURES, randomScripture };
