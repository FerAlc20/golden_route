document.getElementById('startButton').addEventListener('click', () => {
    startGame();
    document.getElementById('menu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
});

document.getElementById('pauseButton').addEventListener('click', () => {
    pauseGame();
});

document.getElementById('instructionsButton').addEventListener('click', () => {
    document.getElementById('instructions').style.display = 'block';
});

document.getElementById('closeInstructions').addEventListener('click', () => {
    document.getElementById('instructions').style.display = 'none';
});

function startGame() {
    // Aquí podrías agregar lógica para iniciar el juego
    console.log("Juego Iniciado");
    // También puedes ocultar el botón de iniciar si deseas
}

function pauseGame() {
    // Aquí podrías agregar la lógica para pausar el juego
    console.log("Juego en Pausa");
}
