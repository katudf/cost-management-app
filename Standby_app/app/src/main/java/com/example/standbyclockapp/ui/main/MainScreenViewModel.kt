package com.example.standbyclockapp.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.standbyclockapp.data.DataRepository
import com.example.standbyclockapp.data.NewsItem
import com.example.standbyclockapp.data.WeatherData
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class MainScreenViewModel(private val dataRepository: DataRepository) : ViewModel() {

  private val _newsState = MutableStateFlow<NewsUiState>(NewsUiState.Loading)
  val newsState: StateFlow<NewsUiState> = _newsState.asStateFlow()

  private val _weatherState = MutableStateFlow<WeatherUiState>(WeatherUiState.Loading)
  val weatherState: StateFlow<WeatherUiState> = _weatherState.asStateFlow()

  private var currentLatitude: Double = 35.6895
  private var currentLongitude: Double = 139.6917

  init {
    startPolling()
  }

  fun updateLocation(latitude: Double, longitude: Double) {
    currentLatitude = latitude
    currentLongitude = longitude
    refreshWeather()
  }

  private fun refreshWeather() {
    viewModelScope.launch {
      try {
        val weather = dataRepository.fetchWeather(currentLatitude, currentLongitude)
        _weatherState.value = WeatherUiState.Success(weather)
      } catch (e: Exception) {
        e.printStackTrace()
        _weatherState.value = WeatherUiState.Error(e)
      }
    }
  }

  private fun startPolling() {
    // Poll news every 15 minutes
    viewModelScope.launch {
      while (true) {
        try {
          val news = dataRepository.fetchNews()
          _newsState.value = NewsUiState.Success(news)
        } catch (e: Exception) {
          e.printStackTrace()
          _newsState.value = NewsUiState.Error(e)
        }
        delay(15 * 60 * 1000L)
      }
    }

    // Poll weather every 30 minutes
    viewModelScope.launch {
      while (true) {
        refreshWeather()
        delay(30 * 60 * 1000L)
      }
    }
  }
}

sealed interface NewsUiState {
  object Loading : NewsUiState
  data class Error(val throwable: Throwable) : NewsUiState
  data class Success(val news: List<NewsItem>) : NewsUiState
}

sealed interface WeatherUiState {
  object Loading : WeatherUiState
  data class Error(val throwable: Throwable) : WeatherUiState
  data class Success(val weather: WeatherData) : WeatherUiState
}
